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