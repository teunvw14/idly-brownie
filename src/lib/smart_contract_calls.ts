import type { Wallet, WalletAccount, WindowRegisterWalletEvent } from '@mysten/wallet-standard';
import { IotaClient } from '@iota/iota-sdk/client';
import { Transaction } from '@iota/iota-sdk/transactions';

import { getObjectExplorerUrl } from '$lib/util';

export let PACKAGE_ID = "0x30a86d4f81fe8609ff7e4774b3fc281597e72c2911e805b3180b05c95baae36e";
export let BROWNIE_INC = "0x2e62d52ab37b4e2e30d9b3a0db67889fd3ec65ea9b0cf914ef1a4dfb9d4548e4";


const GAS_BUDGET = 100_000_000;
const MODULE_NAME = "brownie";
const LICENSE_PRICE_NANO = 10_000_000_000;
const AUTO_BAKER_BUY_FEE = 10_000_000;
const BAKE_BY_HAND_AMOUNT = 10;

export async function buyAccount(
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
    tx.transferObjects([brownies], walletAccount.address);

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
    completionCallback();
}


export async function buyAutoBakers(
    iotaClient: IotaClient, 
    wallet: Wallet,
    walletAccount: WalletAccount,
    brownieAccount: string,
    bakerTypeId: number,
    num: number,
    brownieUnitPrice: number,
    completionCallback: CallableFunction
) {
    // Set up the transaction
    let tx = new Transaction();
    tx.setGasBudget(GAS_BUDGET);

    let [paymentIota] = tx.splitCoins(tx.gas, [AUTO_BAKER_BUY_FEE * num]);

    // Claim brownies
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
    tx.transferObjects([brownies], walletAccount.address);
    
    // Merge brownies
    let holdings = await iotaClient.getOwnedObjects({owner: walletAccount.address, options: {showContent: true}});
    let brownieCoins = holdings.data.filter((obj) => {
        return obj.data?.content?.type.includes(PACKAGE_ID+'::brownie::BROWNIE');
    });
    let brownieCoinsIds = brownieCoins.map((brownie) => brownie.data?.objectId);
    let brownieCoinObjects = brownieCoinsIds.map((id) => tx.object(id));
    if (brownieCoins.length > 1){
        tx.mergeCoins(brownieCoinObjects[0], brownieCoinObjects.slice(1))
    }
    
    let [paymentBrownie] = tx.splitCoins(brownieCoinObjects[0], [num * brownieUnitPrice])
    tx.moveCall({
        package: PACKAGE_ID,
        module: MODULE_NAME,
        function: 'buy_auto_bakers',
        arguments: [
            tx.object(brownieAccount),
            tx.object(BROWNIE_INC),
            tx.pure.u64(bakerTypeId),
            tx.pure.u64(num),
            tx.object(paymentIota),
            tx.object(paymentBrownie),
            tx.object.clock,
        ]
    });

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
    completionCallback();
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
    tx.transferObjects([brownies], walletAccount.address);

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
    completionCallback();
}
