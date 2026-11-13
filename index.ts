import { definePluginSettings } from "@api/Settings";
import definePlugin from "@utils/types";
import { OptionType, type PluginNative } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { MediaEngineStore } from "@webpack/common";

import { matchDevice, matchWebDevice } from "./devices";
import type { Snapshot } from "./devices";

const actions = findByPropsLazy("setInputDevice", "setOutputDevice") as {
    setInputDevice(id: string): void;
    setOutputDevice(id: string): void;
};

const native = () => VencordNative.pluginHelpers.WindowsAudioSync as
    PluginNative<typeof import("./native")> | undefined;

const settings = definePluginSettings({
    syncInput: {
        type: OptionType.BOOLEAN,
        description: "Follow the Windows default microphone",
        default: true,
        onChange: onDeviceChange
    },
    syncOutput: {
        type: OptionType.BOOLEAN,
        description: "Follow the Windows default speakers or headphones",
        default: true,
        onChange: onDeviceChange
    }
});

let controller: AbortController | undefined;
let current: Snapshot | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let retries = 0;

function schedule(delay: number) {
    clearTimeout(timer);
    if (controller && current) timer = setTimeout(() => void apply(), delay);
}

async function apply() {
    const run = controller;
    const snapshot = current;
    if (!run || !snapshot) return;
    if (!settings.store.syncInput && !settings.store.syncOutput) return;
    try {
        const store = MediaEngineStore;
        if (store) {
            const web = await navigator.mediaDevices?.enumerateDevices().catch(() => []) ?? [];
            if (run.signal.aborted || current !== snapshot) return;
            let retry = false;
            if (settings.store.syncInput && snapshot.input) {
                const input = matchDevice(snapshot.input, Object.values(store.getInputDevices()),
                    matchWebDevice(snapshot.input, "audioinput", web));
                if (input && input !== store.getInputDeviceId()) actions.setInputDevice(input);
                retry = !input;
            }
            if (settings.store.syncOutput && snapshot.output) {
                const output = matchDevice(snapshot.output, Object.values(store.getOutputDevices()),
                    matchWebDevice(snapshot.output, "audiooutput", web));
                if (output && output !== store.getOutputDeviceId()) actions.setOutputDevice(output);
                retry = retry || !output;
            }
            if (!retry) return;
        }
    } catch (error) {
        console.warn("[WindowsAudioSync] Failed to select a Discord device", error);
    }
    if (retries++ < 4) schedule(750);
}

function onDeviceChange() {
    retries = 0;
    schedule(250);
}

async function watch(run: AbortController) {
    const api = native();
    if (!api) {
        console.warn("[WindowsAudioSync] Native helper missing from this build");
        return;
    }

    let revision = -1;
    while (!run.signal.aborted) {
        try {
            const snapshot = await api.nextDefaults(revision);
            if (run.signal.aborted) return;
            if (snapshot) {
                current = snapshot;
                revision = snapshot.revision;
                onDeviceChange();
            }
        } catch (error) {
            if (run.signal.aborted) return;
            console.warn("[WindowsAudioSync] Windows audio reader unavailable", error);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

export default definePlugin({
    name: "WindowsAudioSync",
    description: "Selects the Windows default multimedia microphone and speakers in Discord.",
    authors: [{ name: "WindowsAudioSync contributors", id: 0n }],
    settings,
    start() {
        if (!navigator.userAgent.includes("Windows")) return;
        controller = new AbortController();
        navigator.mediaDevices?.addEventListener("devicechange", onDeviceChange);
        void watch(controller);
    },
    stop() {
        if (!controller) return;
        controller.abort();
        controller = undefined;
        current = undefined;
        clearTimeout(timer);
        navigator.mediaDevices?.removeEventListener("devicechange", onDeviceChange);
        void native()?.stopReader().catch(error => console.warn("[WindowsAudioSync]", error));
    }
});

