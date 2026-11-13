import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { IpcMainInvokeEvent } from "electron";

import type { Snapshot } from "./devices";

const reader = String.raw`
using System;
using System.Runtime.InteropServices;
using System.Threading;

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDeviceEnumerator {
    void EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IDevice device);
    void GetDevice(string id, out IDevice device);
    void RegisterEndpointNotificationCallback(INotifications callback);
    void UnregisterEndpointNotificationCallback(INotifications callback);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDevice {
    void Activate(ref Guid iid, int context, IntPtr parameters, out IntPtr result);
    void OpenPropertyStore(int mode, out IProperties store);
    void GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
}

[StructLayout(LayoutKind.Sequential)]
public struct PropertyKey {
    public Guid Format;
    public int Id;
}

[StructLayout(LayoutKind.Explicit, Size = 24)]
struct PropertyValue {
    [FieldOffset(0)] public ushort Type;
    [FieldOffset(8)] public IntPtr Pointer;
}

[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IProperties {
    void GetCount(out int count);
    void GetAt(int index, out PropertyKey key);
    void GetValue(ref PropertyKey key, out PropertyValue value);
}

[ComVisible(true), Guid("7991EEC9-7E89-4D85-8390-6C703CEC60C0"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface INotifications {
    [PreserveSig] int OnDeviceStateChanged([MarshalAs(UnmanagedType.LPWStr)] string id, int state);
    [PreserveSig] int OnDeviceAdded([MarshalAs(UnmanagedType.LPWStr)] string id);
    [PreserveSig] int OnDeviceRemoved([MarshalAs(UnmanagedType.LPWStr)] string id);
    [PreserveSig] int OnDefaultDeviceChanged(int flow, int role, [MarshalAs(UnmanagedType.LPWStr)] string id);
    [PreserveSig] int OnPropertyValueChanged([MarshalAs(UnmanagedType.LPWStr)] string id, PropertyKey key);
}

[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public sealed class AudioNotifications : INotifications {
    public readonly AutoResetEvent Changed = new AutoResetEvent(false);
    public int OnDeviceStateChanged(string id, int state) { Changed.Set(); return 0; }
    public int OnDeviceAdded(string id) { Changed.Set(); return 0; }
    public int OnDeviceRemoved(string id) { Changed.Set(); return 0; }
    public int OnDefaultDeviceChanged(int flow, int role, string id) {
        if (role == 1) Changed.Set();
        return 0;
    }
    public int OnPropertyValueChanged(string id, PropertyKey key) { return 0; }
}

public static class WindowsAudioReader {
    [DllImport("ole32.dll")]
    static extern int PropVariantClear(ref PropertyValue value);

    static string Encode(string value) {
        return Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(value ?? ""));
    }

    static string Read(IDeviceEnumerator enumerator, int flow) {
        IDevice device;
        int result = enumerator.GetDefaultAudioEndpoint(flow, 1, out device);
        if (result == unchecked((int)0x80070490)) return "|";
        Marshal.ThrowExceptionForHR(result);
        try {
            string id;
            device.GetId(out id);
            IProperties store;
            device.OpenPropertyStore(0, out store);
            try {
                var key = new PropertyKey { Format = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), Id = 14 };
                PropertyValue value;
                store.GetValue(ref key, out value);
                try {
                    string name = value.Type == 31 ? Marshal.PtrToStringUni(value.Pointer) : "";
                    return Encode(id) + "|" + Encode(name);
                } finally { PropVariantClear(ref value); }
            } finally { Marshal.ReleaseComObject(store); }
        } finally { Marshal.ReleaseComObject(device); }
    }

    public static void Run(bool once) {
        var enumerator = (IDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(
            new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")));
        var callback = new AudioNotifications();
        bool registered = false;
        try {
            if (!once) {
                enumerator.RegisterEndpointNotificationCallback(callback);
                registered = true;
                // The pipe closes if the Electron main process exits.
                var parentMonitor = new Thread(() => {
                    Console.In.Read();
                    Environment.Exit(0);
                });
                parentMonitor.IsBackground = true;
                parentMonitor.Start();
            }
            do {
                Console.WriteLine("AUDIO|" + Read(enumerator, 1) + "|" + Read(enumerator, 0));
                Console.Out.Flush();
            } while (!once && callback.Changed.WaitOne());
        } finally {
            if (registered) enumerator.UnregisterEndpointNotificationCallback(callback);
            callback.Changed.Dispose();
            Marshal.ReleaseComObject(enumerator);
        }
    }
}
`;

let child: ChildProcessWithoutNullStreams | undefined;
let owner: number | undefined;
let revision = 0;
let snapshot: Snapshot | undefined;
let failure: Error | undefined;
let wake: (() => void) | undefined;
let lease: ReturnType<typeof setTimeout> | undefined;

function close() {
    const old = child;
    child = undefined;
    old?.kill();
    clearTimeout(lease);
    snapshot = undefined;
    owner = undefined;
    wake?.();
}

function start() {
    const script = "$ErrorActionPreference = 'Stop'\nAdd-Type -TypeDefinition @'\n"
        + reader + "\n'@\n[WindowsAudioReader]::Run($false)";
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const executable = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const proc = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
        windowsHide: true,
        stdio: "pipe"
    });
    child = proc;
    failure = undefined;
    let errorText = "";
    proc.stderr.setEncoding("utf8").on("data", chunk => {
        errorText = (errorText + chunk).slice(-2000);
    });
    const lines = createInterface({ input: proc.stdout });
    lines.on("line", line => {
        if (child !== proc || !line.startsWith("AUDIO|")) return;
        const fields = line.split("|").slice(1).map(field => Buffer.from(field, "base64").toString("utf8"));
        if (fields.length !== 4) return;
        const [inputId, inputName, outputId, outputName] = fields;
        snapshot = {
            revision: ++revision,
            input: inputId ? { id: inputId, name: inputName } : null,
            output: outputId ? { id: outputId, name: outputName } : null
        };
        wake?.();
    });
    function failed(error: Error) {
        if (child !== proc) return;
        failure = error;
        close();
    }
    proc.on("error", failed);
    proc.on("close", code => failed(new Error(errorText.trim() || "Windows audio reader exited (" + code + ")")));
    return proc;
}

export async function nextDefaults(event: IpcMainInvokeEvent, after: number): Promise<Snapshot | null> {
    if (process.platform !== "win32") return null;
    const sender = event.sender;
    if (owner !== undefined && owner !== sender.id) throw new Error("Audio reader already in use");
    if (wake) throw new Error("Audio reader already has a pending request");
    if (!child) {
        owner = sender.id;
        const procOwner = sender.id;
        const proc = start();
        const onDestroyed = () => {
            if (owner === procOwner && child === proc) close();
        };
        sender.once("destroyed", onDestroyed);
        proc.once("close", () => sender.removeListener("destroyed", onDestroyed));
    }
    clearTimeout(lease);
    lease = setTimeout(close, 45000);
    if (!snapshot || snapshot.revision === after) {
        await new Promise<void>(resolve => {
            const timer = setTimeout(() => wake?.(), 20000);
            wake = () => {
                clearTimeout(timer);
                wake = undefined;
                resolve();
            };
        });
    }
    if (failure) throw failure;
    return snapshot?.revision !== after ? snapshot ?? null : null;
}

export function stopReader(event: IpcMainInvokeEvent) {
    if (event.sender.id === owner) close();
}



