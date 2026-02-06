export const PumpfunLiveStreamSocketUrl =
	"wss://pump-prod-tg2x8veh.livekit.cloud/rtc";

export type PumpfunLivestreamConnection = {
	websocketUrl: string;
	token: string;
	livestreamData?: PumpfunLivestream;
};

export type PumpfunLivestream = {
	mint: string;
	name: string;
	symbol: string;
	description: string;
	image_uri: string;
	metadata_uri: string;
	twitter: string | null;
	telegram: string | null;
	bonding_curve: string;
	creator: string;
	created_timestamp: number;
	raydium_pool: string;
	num_participants: number;
	complete: boolean;
	thumbnail: string;
	market_id: string;
	usd_market_cap: number;
	is_currently_live: boolean;
	reply_count: number;
	market_cap: number; // usd
};

export type PumpfunCurrentlyLiveResponse = PumpfunLivestream[];

export type PumpfunJoinLivestreamResponse = {
	token: string;
	role: string;
};
