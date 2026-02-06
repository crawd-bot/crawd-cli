import { io, Socket } from "socket.io-client";
import { PumpfunMessage } from "./types";

export class PumpfunSocketClient {
    private readonly socket: Socket;

    constructor(authToken: string | null) {
        this.socket = io("wss://livechat.pump.fun", {
            path: "/socket.io/",
            transports: ["websocket"],
            autoConnect: false,
            withCredentials: true,
            extraHeaders: {
                Host: "livechat.pump.fun",
                Origin: "https://pump.fun",
            },
        });
    }

    connect(): void {
        this.socket.connect();
    }

    disconnect(): void {
        this.socket.disconnect();
    }

    async joinRoom(roomId: string): Promise<void> {
        return new Promise((resolve) => {
            this.socket.emit("joinRoom", { roomId, username: "" });
            setTimeout(resolve, 200);
        });
    }

    async sendMessage(roomId: string, message: string): Promise<void> {
        this.socket.emit("sendMessage2", { roomId, message, username: "" });
    }

    async getMessagesHistory({
        roomId,
        limit,
    }: {
        roomId: string;
        limit?: number;
    }): Promise<PumpfunMessage[]> {
        return new Promise((resolve) => {
            this.socket.emit(
                "getMessageHistory",
                { roomId: roomId, before: null, limit: limit ?? 20 },
                (messages: PumpfunMessage[]) => {
                    resolve(messages);
                },
            );
        });
    }

    onMessage(callback: (message: PumpfunMessage) => void): void {
        this.socket.on("newMessage", callback);
    }
}
