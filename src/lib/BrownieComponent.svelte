<script lang="ts">
    import { getWallets, WalletStandardError } from '@mysten/wallet-standard';
    import { getFullnodeUrl, IotaClient, type IotaObjectData, type IotaObjectResponse } from '@iota/iota-sdk/client';
    import { Transaction } from '@iota/iota-sdk/transactions';
    import { onMount } from 'svelte';
    import { nanosToIota, shortenHex, formatNum, timeHumanReadable, getObjectExplorerUrl, roundFractional, formatNumShort } from '$lib/util'
    import { PACKAGE_ID, BROWNIE_INC, buyAccount, bakeByHand, buyAutoBakers, claimBrownies} from '$lib/smart_contract_calls' 
    
    let activeWallet = $state(null);
    let activeWalletAccount = $state(null);
    let activeWalletAccountBalance = $state(0); 

    let brownieAccount = $state("");
    let brownieBalance = $state(0);

    let buyMultiplier = $state(1);

    let autoBakers: AutoBakerStack[] = $state([]);
    let totalHourlyBakeRate = $derived.by(() => {
        let ratePerHour = 0;
        autoBakers.forEach((autoBakerStack: AutoBakerStack) => {
            ratePerHour += autoBakerStack.number * autoBakerStack.autoBakerType.ratePerHour;
        })
        return ratePerHour;
    })
    let unclaimedBrownies = $derived.by(() => {
        let total = 0;
        autoBakers.forEach((autoBakerStack: AutoBakerStack) => {
            let timeSinceLastClaim = onChainClockTimestampMs - autoBakerStack.lastClaimTimestampMs;
            if (timeSinceLastClaim > 0) {
                total +=  Math.floor(autoBakerStack.number * timeSinceLastClaim * autoBakerStack.autoBakerType.ratePerHour / (3600 * 1000));
            }
        });
        return total;
    })

    let resultText = $state("");
    
    let explorerUrl = "https://explorer.rebased.iota.org/";
    let onChainClockTimestampMs = $state(0);
    const CLOCK_UPDATE_DELAY = 50;

    const iotaClient = new IotaClient({ url: 'https://api.testnet.iota.cafe' });

    interface AutoBakerType {
        id: number,
        name: string,
        priceBrownie: number,
        ratePerHour: number,
    }

    interface AutoBakerStack {
        id: string,
        number: number,
        autoBakerType: AutoBakerType,
        lastClaimTimestampMs: number,
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

    async function updateAutoBakers(accountData: IotaObjectData) {
        autoBakers = []
        let autoBakerStacks = accountData.content.fields["auto_bakers"];
        autoBakerStacks.forEach((stackJson)=> {
            let autoBakerTypeFields = stackJson.fields["auto_baker_type"].fields;
            let stack: AutoBakerStack = {
                id: stackJson.fields["id"].id,
                number: parseInt(stackJson.fields["number"]),
                autoBakerType: {
                    id: parseInt(autoBakerTypeFields["id"]),
                    name: String.fromCharCode(...autoBakerTypeFields["name"]),
                    priceBrownie: parseInt(autoBakerTypeFields["price_brownie"]),
                    ratePerHour: parseInt(autoBakerTypeFields["rate_per_hour"]),
                },
                lastClaimTimestampMs: parseInt(stackJson.fields["last_claim_timestamp_ms"])
            }
            autoBakers.push(stack)
        });
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
                        priceBrownie: parseInt(type.fields["price_brownie"]),
                        ratePerHour: parseInt(type.fields["rate_per_hour"]),
                    },
                    lastClaimTimestampMs: 0
                }
                autoBakers.push(zero_stack)
            }
        });
        console.log(bakerTypes)
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
            }
        };

        // Update BROWNIE balance
        let brownieCoins = holdings.data.filter((obj) => {
            return obj.data?.type.includes(PACKAGE_ID+'::brownie::BROWNIE');
        });
        brownieBalance = 0;
        brownieCoins.forEach(coin => {
            brownieBalance += parseInt(coin.data?.content?.fields.balance)
        });
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

<div class="h-screen w-screen min-w-[600px] bg-slate-100 p-4 md:p-8 font-sans">
<div class="mx-auto min-w-[600px] p-4">
    On-Chain Time: {onChainClockTimestampMs > 0 ? new Date(onChainClockTimestampMs).toLocaleString() : 'Syncing...'}

    <div class="flex flex-col w-full max-w-[800px] mx-auto border-2 items-center bg-slate-200">
        <div class="flex flex-row ">
            <div class="flex flex-col w-1/2 justify-around items-center">
                <div class="flex flex-row gap-2 justify-center items-center p-2">
                    <h1 class="text-2xl sm:text-3xl">{formatNumShort(brownieBalance + unclaimedBrownies)}</h1>
                    <p>BROWNIE</p> 
                </div>
                <h2>Per hour: {totalHourlyBakeRate}</h2>
                <button 
                    onclick={() => claimBrownies(iotaClient, activeWallet, activeWalletAccount, brownieAccount, ()=>{console.log('test'); updateBrownieState()})}
                    class="border-4 border-[#731702] bg-[#BF6341] p-2 m-4 text-white w-[70%]"
                >
                    <p>Claim {formatNumShort(unclaimedBrownies)}</p>
                    <!-- <p></p>  -->
                    <p>baked brownies </p>
                </button>
            </div>
            <img src="https://i.imgur.com/KjYzO0g.png" alt="Brownie Logo" 
            class="mx-auto size-[35%] rounded-full">
        </div>
        <button
            onclick={()=> {initializeWallet(); connectWallet();} }
            class="w-[80%] bg-orange-500 hover:bg-orange-400 text-white font-bold py-2 px-4 rounded transition duration-150 ease-in-out disabled:opacity-60 disabled:cursor-not-allowed"
        >
            {!!activeWalletAccount ? 'Wallet Connected ✅' : 'Connect Wallet'}
        </button>
        <p>Balance: {activeWalletAccountBalance} IOTA</p>
        <h2>Brownie Account: {brownieAccount ? shortenHex(brownieAccount, 4) : "No account"}</h2>
        {#if !brownieAccount}
        <button 
            onclick={() => {buyAccount(iotaClient, activeWallet, activeWalletAccount, updateBrownieState)}}
            class="bg-blue-200 pb-2"
        >
            Buy account (10 IOTA)
        </button>
        {/if}
    </div>

    <div class="flex flex-col m-8 p-2 text-[#260101] bg-[#D99379] w-full rounded-md max-w-[800px] mx-auto">
        <h1 class="font-bold text-xl mx-auto"> Bake some brownies!</h1>
        <button 
            onclick={cycleBuyMultiplier}
            class="p-2 m-2 bg-orange-400"
        >
            {buyMultiplier} x
        </button>
        <div class="w-full flex flex-col">
            <button onclick={()=> {bakeByHand(iotaClient, activeWallet, activeWalletAccount, brownieAccount, updateBrownieState)}}
            class="border-2"
            >
                Click to bake 10 BROWNIE by hand!
            </button>
        </div>
        {#each autoBakers as autoBakerStack}
        <div class="flex flex-row justify-between m-2 p-2 border-1 border-[#260101] rounded-sm">
            <div class="flex flex-col gap-1">
                <div class="flex flex-row gap-2 items-center"><b class="text-xl">{autoBakerStack.autoBakerType.name}</b> <p>{autoBakerStack.number} owned</p></div>
                <div class="flex flex-row gap-2"><b>Unit Rate:</b> <h2>{formatNumShort(autoBakerStack.autoBakerType.ratePerHour)} / h</h2></div>
                <div class="flex flex-row gap-2"><b>Total:</b> <h2>{formatNumShort(autoBakerStack.autoBakerType.ratePerHour * autoBakerStack.number)} / h</h2></div>
            </div>
            <button 
            onclick={() => buyAutoBakers(iotaClient, activeWallet, activeWalletAccount, brownieAccount, autoBakerStack.autoBakerType.id, buyMultiplier, autoBakerStack.autoBakerType.priceBrownie, updateBrownieState)}
            class="w-[50%] border-2 p-2 bg-green-400 rounded-md"
            >
                Buy {buyMultiplier} {autoBakerStack.autoBakerType.name} ({formatNumShort(autoBakerStack.autoBakerType.priceBrownie * buyMultiplier)} BROWNIE)
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