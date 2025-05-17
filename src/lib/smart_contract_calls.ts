import type { Wallet, WalletAccount, WindowRegisterWalletEvent } from '@mysten/wallet-standard';
import { IotaClient } from '@iota/iota-sdk/client';
import { Transaction, type TransactionResult } from '@iota/iota-sdk/transactions';

import { getObjectExplorerUrl } from '$lib/util';
import { CartPlusAltOutline, CheckCircleOutline, InfoCircleSolid, CloseCircleSolid, VolumeMuteSolid, VolumeUpSolid } from 'flowbite-svelte-icons';
import { ToastType } from '$lib'

import type { AutoBakerType, AutoBakerStack, ToastMessage } from '$lib';

export let PACKAGE_ID = "0x239b02dd3e7aefdd1e0a5976c4dba06a037a299dcef5448a197a9a6cfe11c6be";
export let BROWNIE_INC = "0x0503319a9049633a0672aa803f05803acd4a5192c8cfa7d3f5e71e0671b879a9";


const GAS_BUDGET = 100_000_000;
const MODULE_NAME = "brownie";
const LICENSE_PRICE_NANO = 100_000_000;
const AUTO_BAKER_BUY_FEE = 10_000_000;
export const AUTO_BAKER_PRICE_STEP_PCT = 15;
const BAKE_BY_HAND_AMOUNT = 10;

async function handleTxExecution(
    iotaClient: IotaClient,
    tx: Transaction,
    wallet: Wallet,
    walletAccount: WalletAccount,
) {
    let {bytes, signature} = 
    await (wallet.features['iota:signTransaction']).signTransaction({
        transaction: tx, 
        account: walletAccount,
    });
    // Send signed transaction to the network for execution
    let transactionResult = await iotaClient.executeTransactionBlock({
        transactionBlock: bytes,
        signature: signature,
    })
    await iotaClient.waitForTransaction({ digest: transactionResult.digest });
}

export async function createAccount(
    iotaClient: IotaClient, 
    wallet: Wallet,
    walletAccount: WalletAccount,
    completionCallback: CallableFunction
) {
    // Set up the transaction
    let tx = new Transaction();
    tx.setGasBudget(GAS_BUDGET);

    let [payment] = tx.splitCoins(tx.gas, [LICENSE_PRICE_NANO]);
    tx.moveCall({
        package: PACKAGE_ID,
        module: MODULE_NAME,
        function: 'get_baking_account',
        arguments: [
            tx.object(BROWNIE_INC),
            tx.object(payment)
        ]
    });

    await handleTxExecution(iotaClient, tx, wallet, walletAccount);
    
    completionCallback();
}

export async function bakeByHand(
    iotaClient: IotaClient, 
    wallet: Wallet,
    walletAccount: WalletAccount,
    brownieAccount: string,
    completionCallback: CallableFunction
) {
    // Set up the transaction
    let tx = new Transaction();
    tx.setGasBudget(GAS_BUDGET);
    
    let brownies = tx.moveCall({
        package: PACKAGE_ID,
        module: MODULE_NAME,
        function: 'bake_by_hand',
        arguments: [
            tx.object(brownieAccount),
            tx.object(BROWNIE_INC)
        ]
    });
    
    let holdings = await iotaClient.getOwnedObjects({owner: walletAccount.address, options: {showContent: true}});
    let brownieCoins = holdings.data.filter((obj) => {
        return obj.data?.content?.type.includes(PACKAGE_ID+'::brownie::BROWNIE');
    });
    let brownieCoinsIds = brownieCoins.map((brownie) => brownie.data?.objectId);
    let brownieCoinObjects = brownieCoinsIds.map((id) => tx.object(id));
        
    // If no Coin<BROWNIE> owned, then split directly from claimedBrownies.
    // Otherwise, first merge claimedBrownies into the first Coin<BROWNIE>.
    if (brownieCoins.length > 0){
        tx.mergeCoins(brownieCoinObjects[0], [brownies]);
    } else {
        tx.transferObjects([brownies], walletAccount.address);
    }
    
    await handleTxExecution(iotaClient, tx, wallet, walletAccount);

    completionCallback();
}

export async function buyAutoBakers(
    iotaClient: IotaClient, 
    wallet: Wallet,
    walletAccount: WalletAccount,
    brownieAccount: string,
    bakerType: AutoBakerType,
    num: number,
    paymentBrownieAmount: number,
    completionCallback: CallableFunction
) {
    // Set up the transaction
    let tx = new Transaction();
    tx.setGasBudget(GAS_BUDGET);
    
    // Check which Brownie coins account holds
    let holdings = await iotaClient.getOwnedObjects({owner: walletAccount.address, options: {showContent: true}});
    let brownieCoins = holdings.data.filter((obj) => {
        return obj.data?.content?.type.includes(PACKAGE_ID+'::brownie::BROWNIE');
    });
    let brownieCoinsIds = brownieCoins.map((brownie) => brownie.data?.objectId);
    let brownieCoinObjects = brownieCoinsIds.map((id) => tx.object(id));
    
    let claimedBrownies = callClaimBrownies(tx, walletAccount, brownieAccount);
    
    // If no Coin<BROWNIE> owned, then split directly from claimedBrownies.
    // Otherwise, first merge claimedBrownies into the first Coin<BROWNIE>.
    let paymentBrownie;
    if (brownieCoins.length == 0){
        [paymentBrownie] = tx.splitCoins(claimedBrownies, [paymentBrownieAmount]);
        tx.transferObjects(claimedBrownies, walletAccount.address);
    } else {
        tx.mergeCoins(brownieCoinObjects[0], [...brownieCoinObjects.splice(1), claimedBrownies]);
        [paymentBrownie] = tx.splitCoins(brownieCoinObjects[0], [paymentBrownieAmount]);
    }
    
    let [paymentIota] = tx.splitCoins(tx.gas, [AUTO_BAKER_BUY_FEE * num]);
    tx.moveCall({
        package: PACKAGE_ID,
        module: MODULE_NAME,
        function: 'buy_auto_bakers',
        arguments: [
            tx.object(brownieAccount),
            tx.object(BROWNIE_INC),
            tx.pure.u64(bakerType.id),
            tx.pure.u64(num),
            tx.object(paymentIota),
            tx.object(paymentBrownie),
            tx.object.clock,
        ]
    });

    await handleTxExecution(iotaClient, tx, wallet, walletAccount);

    completionCallback();
}

function callClaimBrownies(
    tx: Transaction,
    walletAccount: WalletAccount,
    brownieAccount,
): TransactionResult {
    let brownies = tx.moveCall({
        package: PACKAGE_ID,
        module: MODULE_NAME,
        function: 'claim_brownies',
        arguments: [
            tx.object(BROWNIE_INC),
            tx.object(brownieAccount),
            tx.object.clock
        ]
    });
    return brownies;
}

export async function claimBrownies(
    iotaClient: IotaClient, 
    wallet: Wallet,
    walletAccount: WalletAccount,
    brownieAccount: string,
    completionCallback: CallableFunction
) {
    // Set up the transaction
    let tx = new Transaction();
    tx.setGasBudget(GAS_BUDGET);

    let claimedBrownies = callClaimBrownies(tx, walletAccount, brownieAccount);
    let holdings = await iotaClient.getOwnedObjects({owner: walletAccount.address, options: {showContent: true}});
    let brownieCoins = holdings.data.filter((obj) => {
        return obj.data?.content?.type.includes(PACKAGE_ID+'::brownie::BROWNIE');
    });
    let brownieCoinsIds = brownieCoins.map((brownie) => brownie.data?.objectId);
    let brownieCoinObjects = brownieCoinsIds.map((id) => tx.object(id));
        
    // If no Coin<BROWNIE> owned, then split directly from claimedBrownies.
    // Otherwise, first merge claimedBrownies into the first Coin<BROWNIE>.
    if (brownieCoins.length > 0){
        tx.mergeCoins(brownieCoinObjects[0], [claimedBrownies]);
    } else {
        tx.transferObjects([claimedBrownies], walletAccount.address);
    }

    await handleTxExecution(iotaClient, tx, wallet, walletAccount);
    
    completionCallback();
}
