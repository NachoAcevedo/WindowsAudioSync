import { definePluginSettings } from "@api/Settings";
import definePlugin from "@utils/types";
import { OptionType, type PluginNative } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, MediaEngineStore } from "@webpack/common";

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
        description: "Follow the Windows default microphone and its mute state",
        default: true,
        onChange: onDeviceChange
    },
    syncOutput: {
        type: OptionType.BOOLEAN,
        description: "Follow the Windows default output and deafen when it is muted or at zero volume",
        default: true,
        onChange: onDeviceChange
    }
});

let controller: AbortController | undefined;
let current: Snapshot | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let retries = 0;
let mutedByPlugin = false;
let deafenedByPlugin = false;
let applyingSilence = false;

async function syncSilence(run: AbortController, snapshot: Snapshot) {
    if (applyingSilence) return;
    applyingSilence = true;
    const store = MediaEngineStore;
    const mute = settings.store.syncInput ? snapshot.input?.silent : false;
    const deafen = settings.store.syncOutput ? snapshot.output?.silent : false;
    try {
        if (deafen === false && deafenedByPlugin) {
            if (store.isSelfDeaf()) await FluxDispatcher.dispatch({ type: "AUDIO_TOGGLE_SELF_DEAF" });
            deafenedByPlugin = false;
        }
        if (run.signal.aborted) return;
        if (!store.isSelfDeaf() && mute === true && !store.isSelfMute()) {
            await FluxDispatcher.dispatch({ type: "AUDIO_TOGGLE_SELF_MUTE" });
            mutedByPlugin = store.isSelfMute();
        }
        if (run.signal.aborted) return;
        if (deafen === true && !store.isSelfDeaf()) {
            await FluxDispatcher.dispatch({ type: "AUDIO_TOGGLE_SELF_DEAF" });
            deafenedByPlugin = store.isSelfDeaf();
        }
        if (run.signal.aborted) return;
        if (!store.isSelfDeaf() && mute === false && mutedByPlugin) {
            if (store.isSelfMute()) await FluxDispatcher.dispatch({ type: "AUDIO_TOGGLE_SELF_MUTE" });
            mutedByPlugin = false;
        }
    } finally {
        applyingSilence = false;
        if (controller && (controller !== run || current !== snapshot)) schedule(0);
    }
}

function schedule(delay: number) {
    clearTimeout(timer);
    if (controller && current) timer = setTimeout(() => void apply(), delay);
}

async function apply() {
    const run = controller;
    const snapshot = current;
    if (!run || !snapshot) return;
    try {
        const store = MediaEngineStore;
        if (store) {
            const web = await navigator.mediaDevices?.enumerateDevices().catch(() => []) ?? [];
            if (run.signal.aborted || current !== snapshot) return;
            await syncSilence(run, snapshot);
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
        console.warn("[WindowsAudioSync] Failed to synchronize Discord audio", error);
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
    description: "Follows the Windows default audio devices and synchronizes microphone mute and output deafen.",
    authors: [{ name: "WindowsAudioSync contributors", id: 0n }],
    settings,
    flux: {
        AUDIO_TOGGLE_SELF_MUTE() {
            if (!applyingSilence) mutedByPlugin = false;
        },
        AUDIO_TOGGLE_SELF_DEAF() {
            if (!applyingSilence) deafenedByPlugin = false;
        }
    },
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
        mutedByPlugin = false;
        deafenedByPlugin = false;
        clearTimeout(timer);
        navigator.mediaDevices?.removeEventListener("devicechange", onDeviceChange);
        void native()?.stopReader().catch(error => console.warn("[WindowsAudioSync]", error));
    }
});

