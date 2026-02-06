import dotenv from "dotenv";
import { PumpfunSocketClient } from "./client";

dotenv.config();

export const pumpfunSocketClient = new PumpfunSocketClient(process.env.PUMPFUN_AUTH_TOKEN!);
