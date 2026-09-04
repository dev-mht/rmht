// ─────────────────────────────────────────────────────────────────────────────
//  RMHT — R Milestone HODL Token — app.js V1.0
//  Contrat V1.0 Robinhood Chain Mainnet : ⚠️ À COMPLÉTER après déploiement mainnet
//  Adapté depuis app.js MHT (BSC V2.3) — changements :
//    - Nouvelle chaîne : Robinhood Chain (chainId 4663) au lieu de BSC (56)
//    - Nouvelle adresse contrat (à renseigner ci-dessous une fois déployée)
//    - ABI reconstruite pour coller aux fonctions RÉELLES de RMHT.sol :
//        SUPPRIMÉ : getLPStatus, getFlushLPBalance, getAutoLpBuffer,
//                   getMarketingBuffer, getLPBalance, liquidityInitialized
//                   (mécaniques LP progressive / flush / marketing supprimées
//                   dans RMHT — plus de router, plus d'auto-liquidité)
//        AJOUTÉ    : getRMHTPriceInETH, uniswapV3Pool, configLocked
//    - Vault release : 1,5% / 500 000$ MCap (au lieu de 5% / 1M$ sur MHT) —
//      le pas de progression de la barre de milestone est recalculé en
//      conséquence (STEP = 500 000$ au lieu de 1 000 000$)
//    - Pas de tranches LP ni de flush LP à afficher — remplacé par un lien
//      vers RMHTLiquidityCustodian pour la transparence sur les fees LP
// ─────────────────────────────────────────────────────────────────────────────

// ═════════════════════════════════════════════════════════════════════════════
//  BASCULE MAINNET — une seule chose à faire ici : renseigner les deux adresses
//  ci-dessous après le déploiement. Tant qu'elles sont vides, le dashboard
//  refuse de se connecter à un contrat plutôt que d'afficher des données fausses.
//  Le reste (chaîne, RPC, explorateur) est déjà réglé sur le MAINNET.
// ═════════════════════════════════════════════════════════════════════════════
const CONFIG = {
    contractAddress   : "0xbD4487dad62d23e0677E6a94c99cB0AE45328bA4", // RMHT mainnet
    custodianAddress  : "0x50336e2a1396364895702a5222faC47bD0d38407", // RMHTLiquidityCustodian mainnet
    chainId           : 4663, // Robinhood Chain MAINNET
    chainIdHex        : "0x1237", // 4663 en hexadécimal
    chainName         : "Robinhood Chain",
    rpcUrl            : "https://rpc.mainnet.chain.robinhood.com",
    explorerUrl       : "https://robinhoodchain.blockscout.com/tx/",
    explorerAddressUrl: "https://robinhoodchain.blockscout.com/address/",
    nativeCurrency    : { name: "Ether", symbol: "ETH", decimals: 18 },
};

// true seulement quand une vraie adresse a été renseignée ci-dessus
const CONFIG_READY = /^0x[a-fA-F0-9]{40}$/.test(CONFIG.contractAddress);

const ABI = [
    // ── View ──────────────────────────────────────────────────────────────────
    "function balanceOf(address) view returns (uint256)",
    "function pendingRewardsOf(address) view returns (uint256)",
    "function vaultBalance() view returns (uint256)",
    "function nextMilestoneUSD() view returns (uint256)",
    "function milestonesReached() view returns (uint256)",
    "function getMarketCap() view returns (uint256)",
    "function getRMHTPriceInETH() view returns (uint256)",
    "function getCirculatingSupply() view returns (uint256)",
    "function getEligibleSupply() view returns (uint256)",
    "function lastMilestoneTimestamp() view returns (uint256)",
    "function uniswapV3Pool() view returns (address)",
    "function configLocked() view returns (bool)",
    "function owner() view returns (address)",

    // ── Write ─────────────────────────────────────────────────────────────────
    "function claimRewards() external",
];

// Constantes miroir du contrat (RMHT.sol) — à garder synchronisées si le contrat change
const MILESTONE_STEP_USD    = 500_000;      // MILESTONE_STEP_USD dans RMHT.sol
const MILESTONE_COOLDOWN_SEC = 24 * 3600;   // MILESTONE_COOLDOWN dans RMHT.sol

let _provider, _signer, _contract, _userAddress;
let _refreshInterval = null;

// ── Helpers formatage (ethers v6) ─────────────────────────────────────────────
const fmt = (v, d = 2) =>
    parseFloat(ethers.formatUnits(v, 18)).toLocaleString("fr-FR", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
    });

// getMarketCap() / nextMilestoneUSD() renvoient des DOLLARS ENTIERS (0 decimale)
const fmtUSD = (v) =>
    "$" + Number(v).toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });

const fmtCountdown = (secondsLeft) => {
    if (secondsLeft <= 0) return "Ready ✅";
    const h = Math.floor(secondsLeft / 3600);
    const m = Math.floor((secondsLeft % 3600) / 60);
    const s = secondsLeft % 60;
    return `${h}h ${m}m ${s}s`;
};

// ── Vérifie / bascule le wallet sur Robinhood Chain avant toute interaction ───
async function ensureRobinhoodChain(provider) {
    const network = await provider.getNetwork();
    if (Number(network.chainId) === CONFIG.chainId) return true;

    try {
        await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: CONFIG.chainIdHex }],
        });
        return true;
    } catch (switchErr) {
        // Chaîne pas encore ajoutée au wallet → on propose de l'ajouter
        if (switchErr.code === 4902) {
            try {
                await window.ethereum.request({
                    method: "wallet_addEthereumChain",
                    params: [{
                        chainId: CONFIG.chainIdHex,
                        chainName: CONFIG.chainName,
                        rpcUrls: [CONFIG.rpcUrl],
                        nativeCurrency: CONFIG.nativeCurrency,
                        blockExplorerUrls: [CONFIG.explorerAddressUrl.replace("/address/", "")],
                    }],
                });
                return true;
            } catch (addErr) {
                console.error("Impossible d'ajouter Robinhood Chain:", addErr);
                alert("Merci d'ajouter Robinhood Chain manuellement à votre wallet pour continuer.");
                return false;
            }
        }
        console.error("Impossible de basculer sur Robinhood Chain:", switchErr);
        return false;
    }
}

// ── Appelée par le modal après connexion ──────────────────────────────────────
window.initRMHT = async function(provider, signer, address) {
    if (!CONFIG_READY) {
        alert("The $RMHT contract is not live yet.\n\nThe official address is published on this page at launch — do not trust any address circulating before then.");
        return;
    }
    const onRightChain = await ensureRobinhoodChain(provider);
    if (!onRightChain) return;

    _provider    = provider;
    _signer      = signer;
    _userAddress = address;
    _contract    = new ethers.Contract(CONFIG.contractAddress, ABI, signer);

    await updateUI();

    if (_refreshInterval) clearInterval(_refreshInterval);
    _refreshInterval = setInterval(updateUI, 30000);
};

// ── Mise à jour de l'interface ────────────────────────────────────────────────
// Chaque lecture contrat est isolée (safeCall) : si l'une d'elles revert
// (ex. getMarketCap() pendant la "Grace period" post-setConfig()), les autres
// champs (balance, vault, eligible supply, etc.) continuent quand même à
// s'afficher normalement au lieu de rester bloqués/à 0.
async function updateUI() {
    if (!_contract || !_userAddress) return;

    const safeCall = async (fn, label) => {
        try {
            return await fn();
        } catch (err) {
            console.warn(`updateUI: ${label}() a échoué —`, err.reason || err.message || err);
            return null;
        }
    };

    try {
        const [
            balance,
            pending,
            nextMilestone,
            milestonesDone,
            marketCap,
            eligibleSupply,
            vaultBal,
            lastMilestoneTs,
        ] = await Promise.all([
            safeCall(() => _contract.balanceOf(_userAddress), "balanceOf"),
            safeCall(() => _contract.pendingRewardsOf(_userAddress), "pendingRewardsOf"),
            safeCall(() => _contract.nextMilestoneUSD(), "nextMilestoneUSD"),
            safeCall(() => _contract.milestonesReached(), "milestonesReached"),
            safeCall(() => _contract.getMarketCap(), "getMarketCap"),
            safeCall(() => _contract.getEligibleSupply(), "getEligibleSupply"),
            safeCall(() => _contract.vaultBalance(), "vaultBalance"),
            safeCall(() => _contract.lastMilestoneTimestamp(), "lastMilestoneTimestamp"),
        ]);

        // ── Balance utilisateur ───────────────────────────────────────────────
        const balEl = document.getElementById("mht-balance");
        if (balEl) balEl.textContent = balance !== null ? fmt(balance, 2) + " RMHT" : "—";

        // ── Market Cap (peut être temporairement indisponible : grace period) ──
        const mcEl = document.getElementById("market-cap");
        if (mcEl) mcEl.textContent = marketCap !== null ? fmtUSD(marketCap) : "Grace period…";

        // ── Vault Balance ─────────────────────────────────────────────────────
        const vaultEl = document.getElementById("vault-balance");
        if (vaultEl) vaultEl.textContent = vaultBal !== null ? fmt(vaultBal, 0) + " RMHT" : "—";

        // ── Eligible Supply ───────────────────────────────────────────────────
        const esEl = document.getElementById("eligible-supply");
        if (esEl) esEl.textContent = eligibleSupply !== null ? fmt(eligibleSupply, 0) + " RMHT" : "—";

        // ── Statut connexion ──────────────────────────────────────────────────
        const statusEl = document.getElementById("accountStatus");
        if (statusEl) {
            statusEl.textContent = "Connected (Robinhood Chain)";
            statusEl.className = "fw-bold text-success";
        }

        // ── Milestones ────────────────────────────────────────────────────────
        const msEl = document.getElementById("milestoneStatus");
        if (msEl) msEl.textContent = milestonesDone !== null ? milestonesDone.toString() + " Milestone(s) Reached! 🎉" : "—";

        // ── Cooldown prochain milestone (calculé côté client — RMHT n'expose
        //    pas de getCooldownRemaining(), donc on le dérive de
        //    lastMilestoneTimestamp + MILESTONE_COOLDOWN_SEC) ───────────────────
        const cooldownEl = document.getElementById("milestoneCooldown");
        if (cooldownEl && lastMilestoneTs !== null) {
            const nowSec = Math.floor(Date.now() / 1000);
            const readyAt = Number(lastMilestoneTs) + MILESTONE_COOLDOWN_SEC;
            const remaining = readyAt - nowSec;
            cooldownEl.textContent = remaining > 0
                ? `⏳ Next milestone in: ${fmtCountdown(remaining)}`
                : "✅ Milestone available";
            cooldownEl.className = `info-badge ${remaining > 0 ? "badge-cooldown" : "badge-ready"}`;
        } else if (cooldownEl) {
            cooldownEl.textContent = "—";
        }

        // ── Barre de progression milestone (pas = 500 000$, pas 1M$ comme MHT) ─
        // Nécessite marketCap ET nextMilestone ; l'un des deux peut être null
        // si getMarketCap() a reverté (ex. grace period post-setConfig()).
        const progressBar = document.getElementById("milestoneBar");
        if (progressBar) {
            if (marketCap !== null && nextMilestone !== null) {
                const STEP = BigInt(MILESTONE_STEP_USD); // dollars entiers, pas de 1e18
                const prevMilestone = nextMilestone - STEP;
                let progress = 0;
                if (marketCap >= nextMilestone) {
                    progress = 100;
                } else if (marketCap > prevMilestone) {
                    const numerator   = marketCap - prevMilestone;
                    const denominator = nextMilestone - prevMilestone;
                    progress = Number((numerator * 100n) / denominator);
                }
                progressBar.style.width = progress + "%";
                progressBar.textContent = fmtUSD(marketCap) + " / " + fmtUSD(nextMilestone);
            } else {
                progressBar.style.width = "0%";
                progressBar.textContent = "Grace period…";
            }
        }

        // ── Bouton Claim ──────────────────────────────────────────────────────
        const claimBtn = document.getElementById("claimBtn");
        const pendingFloat = pending !== null ? parseFloat(ethers.formatUnits(pending, 18)) : 0;
        if (claimBtn) {
            if (pendingFloat > 0) {
                claimBtn.innerHTML = `<i class="bi bi-gift me-2"></i>Claim ${fmt(pending, 2)} RMHT`;
                claimBtn.disabled = false;
            } else {
                claimBtn.innerHTML = `<i class="bi bi-gift me-2"></i>No Rewards Yet`;
                claimBtn.disabled = true;
            }
        }

    } catch (err) {
        console.error("updateUI error:", err);
    }
}

// ── Claim Rewards ─────────────────────────────────────────────────────────────
async function claimRewards() {
    if (!_contract) return;
    try {
        const claimBtn = document.getElementById("claimBtn");
        if (claimBtn) claimBtn.innerHTML = `<i class="bi bi-hourglass me-2"></i>Processing…`;

        const tx = await _contract.claimRewards();
        await tx.wait();

        await updateUI();
        alert("✅ Rewards claimed!\n\n" + CONFIG.explorerUrl + tx.hash);

    } catch (err) {
        console.error("Claim error:", err);
        alert("Error: " + (err.reason || err.message));
        await updateUI();
    }
}

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
    const claimBtn = document.getElementById("claimBtn");
    if (claimBtn) claimBtn.addEventListener("click", claimRewards);

    // Auto-connect si déjà connecté
    if (window.ethereum && window.ethereum.selectedAddress) {
        const provider = new ethers.BrowserProvider(window.ethereum);
        provider.getSigner().then(signer => {
            signer.getAddress().then(address => {
                window.initRMHT(provider, signer, address);
                const short = address.slice(0, 6) + "…" + address.slice(-4);
                const connectBtn = document.getElementById("connectWalletBtn");
                if (connectBtn) {
                    connectBtn.innerHTML = `<i class="bi bi-check-circle me-2"></i>${short}`;
                    connectBtn.style.background = "linear-gradient(45deg, #10b981, #3b82f6)";
                    window._mhtConnected = true;
                }
            });
        }).catch(() => {});
    }
});
