// place files you want to import through the `$lib` alias in this folder.
import { CartPlusAltOutline, CheckCircleOutline, InfoCircleSolid, CloseCircleSolid, VolumeMuteSolid, VolumeUpSolid } from 'flowbite-svelte-icons';

export interface ToastMessage {
    message: string,
    type: number,
    icon: CartPlusAltOutline | CheckCircleOutline | InfoCircleSolid | CloseCircleSolid
}

export const ToastType = {
    Info: 0,
    Warning: 1,
}

export function showToast(toastMessages: ToastMessage[], type: number, message: string, icon: CartPlusAltOutline | CheckCircleOutline | InfoCircleSolid, duration_ms: number) {
    toastMessages.push({
        message: message,
        type: type,
        icon: icon,
    });
    setTimeout(() => {
        console.log(toastMessages.length)
        toastMessages = toastMessages.splice(1);
        console.log(toastMessages.length)
    }, duration_ms);
}

export interface AutoBakerType {
    id: number,
    name: string,
    basePriceBrownie: number,
    ratePerHour: number,
}

export interface AutoBakerStack {
    id: string,
    number: number,
    autoBakerType: AutoBakerType,
    lastClaimTimestampMs: number,
    nextPriceBrownie: number,
}