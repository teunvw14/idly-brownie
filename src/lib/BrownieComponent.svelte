<script lang="ts">
    import { getWallets, WalletStandardError } from '@mysten/wallet-standard';
    import { getFullnodeUrl, IotaClient, type IotaObjectData, type IotaObjectResponse } from '@iota/iota-sdk/client';
    import { Transaction } from '@iota/iota-sdk/transactions';
    import { onMount } from 'svelte';
    import { nanosToIota, shortenHex, formatNum, timeHumanReadable, getObjectExplorerUrl, roundFractional, formatNumShort, formatNumShortConstLen } from '$lib/util'
    import { PACKAGE_ID, BROWNIE_INC, AUTO_BAKER_PRICE_STEP_PCT, buyAccount, bakeByHand, buyAutoBakers, claimBrownies} from '$lib/smart_contract_calls' 
    
    let activeWallet = $state(null);
    let activeWalletAccount = $state(null);
    let activeWalletAccountBalance = $state(0); 


    let autoBakerImages = {
        0: "https://i.imgur.com/yQaneY8.png",
        1: "https://i.imgur.com/aWocXLE.png",
        2: "https://i.imgur.com/l9pZiRG.png",
        3: "https://i.imgur.com/NejEXR9.png",        
    }

    let brownieAccount = $state("");
    let hasBrownieAccount = $derived(brownieAccount != "");
    let autoBakers: AutoBakerStack[] = $state([]);
    let totalHourlyBakeRate = $derived.by(() => {
        let ratePerHour = 0;
        autoBakers.forEach((autoBakerStack: AutoBakerStack) => {
            ratePerHour += autoBakerStack.number * autoBakerStack.autoBakerType.ratePerHour;
        })
        return ratePerHour;
    })
    let totalBakeRatePerSecond = $derived(totalHourlyBakeRate / 3600);
    let claimedBrownieBalance = $state(0);
    let unclaimedBrownieBalance = $derived.by(() => {
        let total = 0;
        autoBakers.forEach((autoBakerStack: AutoBakerStack) => {
            let timeSinceLastClaim = onChainClockTimestampMs - autoBakerStack.lastClaimTimestampMs;
            if (timeSinceLastClaim > 0) {
                total +=  Math.floor(autoBakerStack.number * timeSinceLastClaim * autoBakerStack.autoBakerType.ratePerHour / (3600 * 1000));
            }
        });
        return total;
    })
    let totalBrownieBalance = $derived(claimedBrownieBalance + unclaimedBrownieBalance);

    let buyMultiplier = $state(1);
    let actionLoading = $state(false);
    let allowScCalls = $derived(hasBrownieAccount && !actionLoading);

    let explorerUrl = "https://explorer.rebased.iota.org/";
    let onChainClockTimestampMs = $state(0);
    const CLOCK_UPDATE_DELAY = 50;

    const iotaClient = new IotaClient({ url: 'https://api.testnet.iota.cafe' });

    interface AutoBakerType {
        id: number,
        name: string,
        basePriceBrownie: number,
        ratePerHour: number,
    }

    interface AutoBakerStack {
        id: string,
        number: number,
        autoBakerType: AutoBakerType,
        lastClaimTimestampMs: number,
        nextPriceBrownie: number,
    }

    async function initializeWallet() {
        let wallets = getWallets().get();
        if (wallets.length == 0) {
            console.log("No wallets found to connect to. Make sure you installed an IOTA web wallet.");
            return;
        }
        // console.log(wallets)
        // console.log(wallets.filter((w) => {
        //     return ["IOTA Wallet", "Nightly"].includes(w.name);
        // }))

        let eligibleWallets = wallets.filter((w) => {
            return ["IOTA Wallet", "Nightly"].includes(w.name) &&
                w.chains.includes("iota:mainnet");
        })
        // console.log(eligibleWallets)
        activeWallet = eligibleWallets[0];

        // console.log("eligibleWallets");
        // console.log(eligibleWallets);
        if (!activeWallet) {
            console.log("No IOTA wallets found to connect to. Make sure you installed an IOTA web wallet.");
            return;
        }
    }

    async function connectWallet() {
        // console.log(await activeWallet.features['standard:connect'])
        activeWallet.features['standard:events'].on("change", () => {
            activeWalletAccount = activeWallet.accounts[0];
            updateBalance();
        });
        await activeWallet.features['standard:connect'].connect();
        activeWalletAccount = activeWallet.accounts[0];
    }
    
    // Helper function to update the balance of the activeWalletAccount
    async function updateBalance() {
        if (activeWalletAccount) {
            activeWalletAccountBalance = (await iotaClient.getBalance({owner: activeWalletAccount.address})).totalBalance;
        }
    }

    async function updateAutoBakers(accountData: IotaObjectData | null) {
        autoBakers = []
        if (!!accountData) {
            let autoBakerStacks = accountData.content.fields["auto_bakers"];
            autoBakerStacks.forEach((stackJson)=> {
                let autoBakerTypeFields = stackJson.fields["auto_baker_type"].fields;
                let stack: AutoBakerStack = {
                    id: stackJson.fields["id"].id,
                    number: parseInt(stackJson.fields["number"]),
                    autoBakerType: {
                        id: parseInt(autoBakerTypeFields["id"]),
                        name: String.fromCharCode(...autoBakerTypeFields["name"]),
                        basePriceBrownie: parseInt(autoBakerTypeFields["base_price_brownie"]),
                        ratePerHour: parseInt(autoBakerTypeFields["rate_per_hour"]),
                    },
                    lastClaimTimestampMs: parseInt(stackJson.fields["last_claim_timestamp_ms"]),
                    nextPriceBrownie: parseInt(stackJson.fields["next_price_brownie"])
                }
                console.log(stack.nextPriceBrownie);
                autoBakers.push(stack)
            });
        }
        // non-owned auto bakers:
        let brownieInc = await iotaClient.getObject({id: BROWNIE_INC, options: {showContent: true}});
        let bakerTypes = brownieInc.data?.content.fields["auto_baker_types"]
        bakerTypes.forEach((type)=> {
            let hasType = autoBakers.filter((stack) => stack.autoBakerType.id == type.fields["id"]).length > 0;
            if (!hasType) {
                let zero_stack: AutoBakerStack = {
                    id: "",
                    number: 0,
                    autoBakerType: {
                        id: parseInt(type.fields["id"]),
                        name: String.fromCharCode(...type.fields["name"]),
                        basePriceBrownie: parseInt(type.fields["base_price_brownie"]),
                        ratePerHour: parseInt(type.fields["rate_per_hour"]),
                    },
                    lastClaimTimestampMs: 0,
                    nextPriceBrownie: parseInt(type.fields["base_price_brownie"]),
                }
                autoBakers.push(zero_stack)
            }
        });
    }

    async function updateBrownieState() {
        let holdings = await iotaClient.getOwnedObjects({owner: activeWalletAccount.address, options: {showContent: true, showType: true}});
        console.log(holdings)
        // Get brownie::Account
        let brownieAccountObjects = holdings.data.filter((obj) => {
            return obj.data?.type.includes(PACKAGE_ID + '::brownie::Account');
        });
        if (brownieAccountObjects.length > 0) {
            if (brownieAccountObjects[0].data) {
                brownieAccount = brownieAccountObjects[0].data.objectId;
                updateAutoBakers(brownieAccountObjects[0].data);
            };
        } else {
            updateAutoBakers(null);
        };

        // Update BROWNIE balance
        let brownieCoins = holdings.data.filter((obj) => {
            return obj.data?.type.includes(PACKAGE_ID+'::brownie::BROWNIE');
        });
        claimedBrownieBalance = 0;
        brownieCoins.forEach(coin => {
            claimedBrownieBalance += parseInt(coin.data?.content?.fields.balance)
        });
        actionLoading = false;
    }

    function calculatePurchasePrice(stack: AutoBakerStack) {
        let result = 0;
        let nextPrice = stack.nextPriceBrownie;
        for (let i = 1; i <= buyMultiplier; i++) {
            result += nextPrice;
            nextPrice = Math.floor(nextPrice * (100 + AUTO_BAKER_PRICE_STEP_PCT) / 100.0);
        }
        // console.log(result);
        // console.log(brownieBalance);
        return result;
    }

    async function initOnChainClockTimestampMs() {
        let clock = await iotaClient.getObject({id: '0x06', options: {showContent: true}});
        onChainClockTimestampMs = parseFloat(clock.data?.content.fields["timestamp_ms"]);

        clockUpdate();
    }

    function clockUpdate() {
        setTimeout(() => {
            onChainClockTimestampMs += CLOCK_UPDATE_DELAY;
            clockUpdate();
        }, CLOCK_UPDATE_DELAY);
    }

    function cycleBuyMultiplier() {
        switch(buyMultiplier) {
            case 1:
                buyMultiplier = 10;
                break;
            case 10:
                buyMultiplier = 25;
                break;
            case 25:
                buyMultiplier = 100
                break;
            case 100:
                buyMultiplier = 1
                break;
        }
    }

    async function initState() {
        await initializeWallet();
        await connectWallet();
        await initOnChainClockTimestampMs();
        await updateBrownieState();
    }

    onMount(() => {
        initState();
    })
    
</script>

<div class="flex flex-col items-center h-[100vh] w-screen min-w-[600px] bg-red-200 font-sans">
<div id="header" 
class="w-full h-[15vh]
    flex flex-row justify-between items-center
    bg-[#D99379] border-[#731702] border-b-8"
>
    <div class="w-[33%] flex flex-row justify-start items-center px-8">
        <button
            onclick={()=> {initializeWallet(); connectWallet();} }
            class="w-[80%] h-[65%] bg-[#731702] hover:bg-[#af6856] text-white font-bold rounded transition duration-150 ease-in-out disabled:opacity-60 disabled:cursor-not-allowed"
        >
            {!!activeWalletAccount ? 'Wallet Connected ✅' : 'Connect Wallet'}
            {#if activeWalletAccount}
            <p>
                {shortenHex(activeWalletAccount.address, 4)}
            </p>
            {/if}
        </button>
    </div>
    <div class="w-[34%] h-full flex flex-row justify-center items-center">
        <img src="https://i.imgur.com/saQrZNb.png" alt="logo" class="h-full">
    </div>
    <div class="w-[33%] mr-4 flex flex-col justify-end items-end px-8">
        <p>On-chain Time:</p>
        <p>{onChainClockTimestampMs > 0 ? new Date(onChainClockTimestampMs).toLocaleString() : 'Syncing...'}</p>
    </div>
</div>

<div class="min-w-[500px] w-[80%] sm:w-[70%] md:w-[60%] p-4 flex flex-col overflow-y-scroll no-scrollbar items-center">
    <div class="flex flex-col p-4 items-center bg-[#D99379] border-8 border-[#731702] w-full h-[90%]">
        {#if !hasBrownieAccount}
        <button 
            onclick={() => {buyAccount(iotaClient, activeWallet, activeWalletAccount, updateBrownieState)}}
            class="bg-blue-200 p-2 w-full h-20"
        >
            No IdlyBrownie Account Found. Click here to create!
        </button>
        {:else}
            <h2>Brownie Account: <a href={"https://iotascan.com/testnet/object/" + brownieAccount} class="hover:underline">{shortenHex(brownieAccount, 4)}</a></h2>
        {/if}
        <div class="flex flex-col items-center h-full w-full">
            <button onclick={()=> {actionLoading = true; bakeByHand(iotaClient, activeWallet, activeWalletAccount, brownieAccount, updateBrownieState)}}
                class="h-[60%] rounded-full"
                disabled={!hasBrownieAccount || !allowScCalls}
                >
                    <img src="https://i.imgur.com/KjYzO0g.png" alt="Brownie Logo" 
                class="size-full">
            </button>
            <div class="flex flex-col w-full justify-around items-center">
                <div class="flex flex-row gap-2 justify-center items-center p-2">
                    <h1 class="text-2xl sm:text-3xl">{formatNumShortConstLen(totalBrownieBalance)}</h1>
                    <p>BROWNIE</p> 
                </div>
                <h2>{formatNumShort(totalBakeRatePerSecond)} / s</h2>
                <button 
                    onclick={() => claimBrownies(iotaClient, activeWallet, activeWalletAccount, brownieAccount, ()=>{console.log('test'); updateBrownieState()})}
                    class="border-4 border-[#731702] bg-[#BF6341] p-2 m-4 text-white w-[70%]"
                    disabled={!hasBrownieAccount}
                >
                    <p>Claim {formatNumShortConstLen(unclaimedBrownieBalance)}</p>
                    <p>baked brownies </p>
                </button>
            </div>
        </div>
    </div>

    <div class="flex flex-col items-center m-8 p-2 text-[#260101] bg-[#D99379] border-8 border-[#731702] w-full rounded-md max-w-[800px]">
        <div class="w-full flex flex-row justify-between items-center">
            <h1 class="font-bold text-xl m-4"> Bake some brownies!</h1>
            <button 
                onclick={cycleBuyMultiplier}
                class="w-1/4 p-2 m-4 bg-orange-400"
                disabled={!hasBrownieAccount}
            >
                {buyMultiplier} x
            </button>
        </div>
        {#each autoBakers as autoBakerStack}
        <div class="flex flex-row justify-between m-2 p-2 border-4 border-[#731702] rounded-sm h-[25vh]">
            <div class="w-[40%] flex flex-col justify-end">
                <img src={autoBakerImages[autoBakerStack.autoBakerType.id]} alt="AutoBaker" class="h-full aspect-square">
            </div>
            <div class="flex flex-col gap-1 w-[35%] pt-4">
                <div class="flex flex-row gap-2 items-center"><b class="text-xl">{autoBakerStack.autoBakerType.name}</b> </div>
                <div class="flex flex-row gap-2"><b>Owned:</b> <p>{autoBakerStack.number}</p></div>
                <div class="flex flex-row gap-2"><b>Unit Rate:</b> <h2>{formatNumShortConstLen(autoBakerStack.autoBakerType.ratePerHour)} / h</h2></div>
                <div class="flex flex-row gap-2"><b>Total:</b> <h2>{formatNumShortConstLen(autoBakerStack.autoBakerType.ratePerHour * autoBakerStack.number)} / h</h2></div>
            </div>
            <button 
            onclick={() => {actionLoading = true; buyAutoBakers(iotaClient, activeWallet, activeWalletAccount, brownieAccount, autoBakerStack.autoBakerType.id, buyMultiplier, calculatePurchasePrice(autoBakerStack), updateBrownieState)}}
            class="w-[25%] border-2 p-2 bg-[#9ab503] hover:bg-[#b4c16a] rounded-md disabled:bg-[#6c7730]"
            disabled={totalBrownieBalance < calculatePurchasePrice(autoBakerStack) || !allowScCalls}
            >
                <p>Buy {buyMultiplier}</p>
                <p>({formatNumShort(calculatePurchasePrice(autoBakerStack))} BROWNIE)</p>
            </button>
        </div>
        {/each}
        <!-- <div>
            <h1>Brownie Factory</h1>
            <button 
            onclick={() => buyAutoBakers(iotaClient, activeWallet, activeWalletAccount, brownieAccount, 1, 1, 200, updateBrownieState)}
            class="border-2 bg-green-400"
            >
                Buy Factory (200 BROWNIE)
            </button>
        </div> -->
    </div>

</div>    
</div>