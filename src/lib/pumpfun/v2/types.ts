export interface UserProfile {
    address: string;
    likes_received: number;
    unread_notifs_count: number;
    mentions_received: number;
    username: string;
    profile_image: string;
    last_username_update_timestamp: number;
    following: number;
    followers: number;
    bio: string;
    x_username: string | null;
    x_id: string | null;
}

export interface FollowerInfo {
    username: string;
    profile_image: string;
    address: string;
    timestamp: number;
    followers: number;
}

export interface TokenCoin {
    mint: string;
    name: string;
    symbol: string;
    image_uri: string;
    creator: string;
    market_cap: number;
    usd_market_cap: number;
}

export interface PnlInfo {
    realized_pnl: {
        percent: string;
        usd: string;
    };
    unrealized_pnl: {
        percent: string;
        usd: string;
    };
    total_usd_in: string;
    total_usd_out: string;
    total_pnl: {
        percent: string;
        usd: string;
    };
}

export interface HoldingToken {
    mint: string;
    balance: string;
    price: string;
    fetchedAt: string;
    balanceUSD: string;
    coin: TokenCoin;
    pnl: PnlInfo;
}

export interface WalletBalances {
    items: HoldingToken[];
    total: number;
    nextCursor: string;
    nativeBalance: number;
    itemCount: number;
    totalBalanceUSD: number;
    lastUpdated: string;
}

export interface CreatorFee {
    bucket: string;
    creatorFee: string;
    creatorFeeSOL: string;
    numTrades: number;
    cumulativeCreatorFee: string;
    cumulativeCreatorFeeSOL: string;
}

export interface TotalFees {
    totalFees: string;
    totalFeesSOL: string;
}

export interface Livestream {
    mint: string;
    name: string;
    symbol: string;
    description: string;
    image_uri: string;
    metadata_uri: string;
    twitter: string | null;
    telegram: string | null;
    bonding_curve: string;
    associated_bonding_curve: string;
    creator: string;
    created_timestamp: number;
    raydium_pool: string | null;
    complete: boolean;
    virtual_sol_reserves: number;
    virtual_token_reserves: number;
    hidden: boolean | null;
    total_supply: number;
    website: string;
    show_name: boolean;
    last_trade_timestamp: number;
    king_of_the_hill_timestamp: number;
    market_cap: number;
    nsfw: boolean;
    market_id: string | null;
    inverted: boolean;
    real_sol_reserves: number;
    real_token_reserves: number;
    livestream_ban_expiry: number;
    last_reply: number;
    reply_count: number;
    is_banned: boolean;
    is_currently_live: boolean;
    initialized: boolean;
    video_uri: string | null;
    updated_at: string | null;
    pump_swap_pool: string;
    ath_market_cap: number;
    ath_market_cap_timestamp: number;
    banner_uri: string;
    hide_banner: boolean;
    livestream_downrank_score: number;
    program: string | null;
    platform: string | null;
    thumbnail: string;
    thumbnail_updated_at: number;
    num_participants: number;
    downrank_score: number;
    usd_market_cap: number;
}

export interface LivestreamClip {
    roomName: string;
    clipId: string;
    sessionId: string;
    startTime: string;
    endTime: string;
    duration: number;
    playlistUrl: string;
    mp4S3Key: string;
    mp4SizeBytes: number;
    mp4CreatedAt: string;
    thumbnailUrl: string;
    thumbnailS3Key: string;
    playlistS3Key: string;
    hidden: boolean;
    clipType: string;
    createdAt: string;
}

export interface LivestreamClipsResponse {
    clips: LivestreamClip[];
}

export interface MarketActivityPeriod {
    numTxs: number;
    volumeUSD: number;
    numUsers: number;
    numBuys: number;
    numSells: number;
    buyVolumeUSD: number;
    sellVolumeUSD: number;
    numBuyers: number;
    numSellers: number;
    priceChangePercent: number;
}

export interface MarketActivity {
    "5m": MarketActivityPeriod | null;
    "1h": MarketActivityPeriod | null;
    "6h": MarketActivityPeriod | null;
    "24h": MarketActivityPeriod | null;
}

export interface WalletBalancesOptions {
    includePnl?: boolean;
    page?: number;
    limit?: number;
}

export interface CreatorFeesOptions {
    interval?: string;
    limit?: number;
}

export interface LivestreamClipsOptions {
    limit?: number;
    clipType?: string;
}

export interface MarketTrade {
    slotIndexId: string;
    tx: string;
    timestamp: string;
    userAddress: string;
    type: string;
    program: string;
    priceUsd: string;
    priceSol: string;
    amountUsd: string;
    amountSol: string;
    baseAmount: string;
    quoteAmount: string;
}

export interface MarketTradesResponse {
    trades: MarketTrade[];
}

export interface Candle {
    timestamp: number;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
}

export interface CandlesOptions {
    interval?: string;
    limit?: number;
    currency?: string;
    createdTs?: number;
}

export type JoinLivestreamResponse = {
    token: string;
    role: string;
};
