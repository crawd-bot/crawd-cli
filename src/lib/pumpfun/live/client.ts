import type {
	PumpfunCurrentlyLiveResponse,
	PumpfunJoinLivestreamResponse,
	PumpfunLivestreamConnection,
} from "./types";
import { PumpfunLiveStreamSocketUrl } from "./types";

export class Pumpfun {
	public async getLivestream(
		mint: string,
	): Promise<PumpfunLivestreamConnection> {
		const url = `https://livestream-api.pump.fun/livestream/join`;

		try {
			const [joinResponse, currentlyLiveData] = await Promise.all([
				fetch(url, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						mintId: mint,
						viewer: true,
						hidden: true,
					}),
				}),
				this.getLivestreams(),
			]);

			if (!joinResponse.ok) {
				throw new Error(
					`Failed to fetch livestreams: ${joinResponse.status} ${joinResponse.statusText}`,
				);
			}

			const data = (await joinResponse.json()) as PumpfunJoinLivestreamResponse;

			const livestreamData = currentlyLiveData.find(
				(stream) => stream.mint === mint,
			);

			return {
				token: data.token,
				websocketUrl: PumpfunLiveStreamSocketUrl,
				livestreamData,
			};
		} catch (error) {
			throw error;
		}
	}

	public async getLivestreams(): Promise<PumpfunCurrentlyLiveResponse> {
		const url = `https://frontend-api-v3.pump.fun/coins/currently-live?offset=0&limit=1000&sort=currently_live&order=DESC&includeNsfw=true`;

		try {
			const response = await fetch(url);

			if (!response.ok) {
				throw new Error(
					`Failed to fetch livestreams: ${response.status} ${response.statusText}`,
				);
			}

			return (await response.json()) as PumpfunCurrentlyLiveResponse;
		} catch (error) {
			throw error;
		}
	}
}
