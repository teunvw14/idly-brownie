<script lang="ts">
    import { getWallets, WalletStandardError } from '@mysten/wallet-standard';
    import { getFullnodeUrl, IotaClient, type IotaObjectData, type IotaObjectResponse } from '@iota/iota-sdk/client';
    import { Transaction } from '@iota/iota-sdk/transactions';
    import { onMount } from 'svelte';
    import { nanosToIota, shortenHex, timeHumanReadable, getObjectExplorerUrl, roundFractional } from '$lib/util'
    import { PACKAGE_ID, BROWNIE_INC, buyAccount, bakeByHand, buyAutoBakers, claimBrownies} from '$lib/smart_contract_calls' 
    
    let activeWallet = $state(null);
    let activeWalletAccount = $state(null);
    let activeWalletAccountBalance = $state(0); 

    let brownieAccount = $state("");
    let brownieBalance = $state(0);

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
    const CLOCK_UPDATE_DELAY = 250;

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
        await activeWallet.features['standard:connect'].connect();
        activeWalletAccount = activeWallet.accounts[0];
        activeWallet.features['standard:events'].on("change", () => {
            activeWalletAccount = activeWallet.accounts[0];
            updateBalance();
        });
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
        let brownieInc = await iotaClient.multiGetObjects({ids: [BROWNIE_INC], options: {showContent: true}});
        let bakerTypes = brownieInc
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

    <div class="flex flex-col w-full max-w-[800px] mx-auto border-2">
        <div class="flex flex-row">
            <h1 class="mx-auto my-auto text-xl sm:text-3xl">{brownieBalance + unclaimedBrownies} BROWNIE</h1> 
            <h2>Per hour: {totalHourlyBakeRate}</h2>
            <button 
                onclick={() => claimBrownies(iotaClient, activeWallet, activeWalletAccount, brownieAccount, ()=>{console.log('test'); updateBrownieState()})}
                class="bg-red-300"
            >
                Claim {unclaimedBrownies} baked brownies 
            </button>
            <img src="https://i.imgur.com/1i1ybKY.png" alt="Brownie Logo" 
            class="mx-auto size-48 rounded-full border-2 border-amber-700">
        </div>
        <button
            onclick={()=> {initializeWallet(); connectWallet();} }
            class="bg-orange-500 hover:bg-orange-400 text-white font-bold py-2 px-4 rounded transition duration-150 ease-in-out disabled:opacity-60 disabled:cursor-not-allowed"
        >
            {!!activeWalletAccount ? 'Wallet Connected ✅' : 'Connect Wallet'}
        </button>
        <p>Balance: {activeWalletAccountBalance}</p>
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

    <div class="flex flex-col m-8 bg-[#CFA77E] w-full max-w-[800px] mx-auto">
        <h1 class="font-bold text-xl mx-auto"> Bake some brownies!</h1>
        <div class="w-full flex flex-col">
            <h2 class="mx-auto">Bake by hand</h2>
            <button onclick={()=> {bakeByHand(iotaClient, activeWallet, activeWalletAccount, brownieAccount, updateBrownieState)}}
            class="border-2"
            >
                Click to bake 10 BROWNIE!
            </button>
        </div>
        {#each autoBakers as autoBakerStack}
        <div class="flex flex-row justify-between my-2 p-2 border-1 h-24">
            <h1>{autoBakerStack.autoBakerType.name} (have: {autoBakerStack.number})</h1>
            <button 
            onclick={() => buyAutoBakers(iotaClient, activeWallet, activeWalletAccount, brownieAccount, autoBakerStack.autoBakerType.id, 1, autoBakerStack.autoBakerType.priceBrownie, updateBrownieState)}
            class="w-[50%] border-2 p-2 bg-green-400"
            >
                Buy {autoBakerStack.autoBakerType.name} ({autoBakerStack.autoBakerType.priceBrownie} BROWNIE)
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