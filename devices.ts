export interface Endpoint {
    id: string;
    name: string;
}

export interface Snapshot {
    revision: number;
    input: Endpoint | null;
    output: Endpoint | null;
}

interface DiscordDevice {
    id: string;
    name: string;
    index?: number;
    guid?: string;
    disabled?: boolean;
}

function normalize(name: string) {
    return name.normalize("NFC").trim().toLowerCase();
}

function endpointGuid(id: string) {
    return id.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?=\}?$)/i)?.[0].toLowerCase();
}

export function matchDevice(endpoint: Endpoint, devices: readonly DiscordDevice[], webId?: string) {
    const candidates = devices.filter(device =>
        device.id && device.id !== "default" && device.id !== "communications" && device.index !== -1 && !device.disabled
    );
    const id = normalize(endpoint.id);
    const exact = candidates.find(device => normalize(device.id) === id || device.id === webId);
    if (exact) return exact.id;

    const guid = endpointGuid(id);
    if (guid) {
        const matches = candidates.filter(device => endpointGuid(device.guid ?? device.id) === guid);
        if (matches.length === 1) return matches[0].id;
    }

    const name = normalize(endpoint.name);
    if (!name) return;
    const matches = candidates.filter(device => normalize(device.name) === name);
    if (matches.length === 1) return matches[0].id;
}

export function matchWebDevice(endpoint: Endpoint, kind: MediaDeviceKind, devices: readonly MediaDeviceInfo[]) {
    const name = normalize(endpoint.name);
    if (!name) return;
    const matches = devices.filter(device => device.kind === kind && device.deviceId &&
        device.deviceId !== "default" && device.deviceId !== "communications" && normalize(device.label) === name
    );
    if (matches.length === 1) return matches[0].deviceId;
}
