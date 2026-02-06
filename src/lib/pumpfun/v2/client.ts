import {
    Candle,
    CandlesOptions,
    CreatorFee,
    CreatorFeesOptions,
    FollowerInfo,
    JoinLivestreamResponse,
    Livestream,
    LivestreamClipsOptions,
    LivestreamClipsResponse,
    MarketTradesResponse,
    TotalFees,
    UserProfile,
    WalletBalances,
    WalletBalancesOptions,
} from "./types";

export class PumpFunClient {
    private readonly frontendApiBase = "https://frontend-api-v3.pump.fun";
    private readonly swapApiBase = "https://swap-api.pump.fun";
    private readonly livestreamApiBase = "https://livestream-api.pump.fun";

    private async fetch<T>(url: string): Promise<T> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    async getUserProfile(username: string): Promise<UserProfile> {
        return this.fetch<UserProfile>(`${this.frontendApiBase}/users/${username}`);
    }

    async getFollowers(walletAddress: string): Promise<FollowerInfo[]> {
        return this.fetch<FollowerInfo[]>(`${this.frontendApiBase}/following/followers/${walletAddress}`);
    }

    async getFollowing(walletAddress: string): Promise<FollowerInfo[]> {
        return this.fetch<FollowerInfo[]>(`${this.frontendApiBase}/following/${walletAddress}`);
    }

    async getWalletBalances(walletAddress: string, options: WalletBalancesOptions = {}): Promise<WalletBalances> {
        const params = new URLSearchParams();
        if (options.includePnl !== undefined) {
            params.append("includePnl", String(options.includePnl));
        }
        if (options.page !== undefined) {
            params.append("page", String(options.page));
        }
        if (options.limit !== undefined) {
            params.append("limit", String(options.limit));
        }
        const queryString = params.toString();
        const url = `${this.swapApiBase}/v1/wallet/${walletAddress}/balances${queryString ? `?${queryString}` : ""}`;
        return this.fetch<WalletBalances>(url);
    }

    async getCreatorFees(walletAddress: string, options: CreatorFeesOptions = {}): Promise<CreatorFee[]> {
        const params = new URLSearchParams();
        if (options.interval !== undefined) {
            params.append("interval", options.interval);
        }
        if (options.limit !== undefined) {
            params.append("limit", String(options.limit));
        }
        const queryString = params.toString();
        const url = `${this.swapApiBase}/v1/creators/${walletAddress}/fees${queryString ? `?${queryString}` : ""}`;
        return this.fetch<CreatorFee[]>(url);
    }

    async getTotalFees(walletAddress: string): Promise<TotalFees> {
        return this.fetch<TotalFees>(`${this.swapApiBase}/v1/creators/${walletAddress}/fees/total`);
    }

    async getCoin(mint: string): Promise<Livestream> {
        return this.fetch<Livestream>(`${this.frontendApiBase}/coins-v2/${mint}`);
    }

    async getCurrentLivestreams(): Promise<Livestream[]> {
        return this.fetch<Livestream[]>(`${this.frontendApiBase}/coins-v2/currently-live`);
    }

    async getLivestreamClips(mint: string, options: LivestreamClipsOptions = {}): Promise<LivestreamClipsResponse> {
        const params = new URLSearchParams();
        if (options.limit !== undefined) {
            params.append("limit", String(options.limit));
        }
        if (options.clipType !== undefined) {
            params.append("clipType", options.clipType);
        }
        const queryString = params.toString();
        const url = `${this.livestreamApiBase}/clips/${mint}${queryString ? `?${queryString}` : ""}`;
        return this.fetch<LivestreamClipsResponse>(url);
    }

    async getMarketActivity(mint: string): Promise<MarketTradesResponse> {
        return this.fetch<MarketTradesResponse>(`${this.swapApiBase}/v2/coins/${mint}/trades`);
    }

    async getCandles(mint: string, options: CandlesOptions = {}): Promise<Candle[]> {
        const params = new URLSearchParams();
        if (options.interval !== undefined) {
            params.append("interval", options.interval);
        }
        if (options.limit !== undefined) {
            params.append("limit", String(options.limit));
        }
        if (options.currency !== undefined) {
            params.append("currency", options.currency);
        }
        if (options.createdTs !== undefined) {
            params.append("createdTs", String(options.createdTs));
        }
        const qs = params.toString();
        const url = `${this.swapApiBase}/v2/coins/${mint}/candles${qs ? `?${qs}` : ""}`;
        return this.fetch<Candle[]>(url);
    }

    async joinLivestream(mint: string): Promise<JoinLivestreamResponse> {
        const response = await fetch("https://livestream-api.pump.fun/livestream/join", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                mintId: mint,
                viewer: true,
                hidden: true,
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to join the livestream: ${response.status} ${response.statusText}`);
        }

        return (await response.json()) as JoinLivestreamResponse;
    }
}
