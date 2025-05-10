// util.ts

import { scale } from "svelte/transition";

export function getObjectExplorerUrl(explorerUrl: string, id: string) {
    return explorerUrl + "/object/" + id
}

export function nanosToIota(amount: number): number {
    return amount / 1_000_000_000;
}

export function shortenHex(hex: string, visibleChars: number) {
    return hex.slice(0, 2+visibleChars) + "..." + hex.slice(-(visibleChars), -1) + hex.at(hex.length - 1)
}

export function timeHumanReadable(miliseconds: number) {
    let returntext = '';
    let seconds = Math.floor(miliseconds / 1000);
    var levels = [
        [Math.floor(seconds / 31536000), 'y'],
        [Math.floor((seconds % 31536000) / 86400), 'd'],
        [Math.floor(((seconds % 31536000) % 86400) / 3600), 'h'],
        [Math.floor((((seconds % 31536000) % 86400) % 3600) / 60), 'm'],
        [(((seconds % 31536000) % 86400) % 3600) % 60, 's'],
    ];

    for (var i = 0, max = levels.length; i < max; i++) {
        if ( levels[i][0] === 0 ) continue;
        returntext += ' ' + levels[i][0] + '' + levels[i][1] + ' ';
    };
    return returntext.trim();
}

export function roundFractional(num: number, decimals: number) {
    return Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export function formatNum(num: number) {
    let asString = num.toString()
    let result = "";
    let i = asString.length - 1;
    while (i >= 0) {
        result = asString.at(i) + result
        if (i % 3 == 0) {
            result = '.' + result
        }
        i -= 1;
    }
    if (result.startsWith('.')) {
        result = result.slice(1)
    }
    return result
}

export function formatNumShort(num: number) {
    let scales = [
        [10**0, ''],
        [10**3, 'K'],
        [10**6, 'M'],
        [10**9, 'B'],
        [10**12, 'T']
    ]
    let max_scale = scales[0];
    let i = 0;
    while (i < scales.length) {
        if (num >= scales[i][0]) {
            max_scale = scales[i];
        }
        i += 1;
    }

    const scaledNum: number = num / max_scale[0];
    const formattedNum: string = scaledNum.toFixed(2);

    return formattedNum + ' ' + max_scale[1]
}