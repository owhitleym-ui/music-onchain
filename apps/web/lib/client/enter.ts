"use client";

// The two transactions behind "Confirm $5 prediction":
//   1. USDC.approve(Competition, entryFee)   - lets the contract take exactly one entry fee
//   2. Competition.enter(id, prediction)     - takes the fee and records the guess
// Step 1 is skipped when an earlier approval still covers the fee.
// Both are simulated first so contract errors come back as readable messages, not failed transactions.
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  erc20Abi,
  http,
  parseGwei,
  type Address,
  type WalletClient,
} from "viem";
import { competitionAbi } from "@/lib/abi/Competition";
import { chain, config } from "./config";

// Arc confirms in under a second, so poll for receipts every second instead of viem's default 4s.
export const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl), pollingInterval: 1_000 });

export type EnterStep = "approve" | "enter" | "done";

/** Arc silently drops transactions priced under 20 gwei, so set a floor there. */
async function fees() {
  if (!config.isArc) return {};
  const estimate = await publicClient.estimateFeesPerGas();
  const floor = parseGwei("25");
  return {
    maxFeePerGas: estimate.maxFeePerGas > floor ? estimate.maxFeePerGas : floor,
    maxPriorityFeePerGas: estimate.maxPriorityFeePerGas,
  };
}

/** Contract custom errors (from Competition.sol) translated for fans. */
const FRIENDLY: Record<string, string> = {
  AlreadyEntered: "You've already entered this competition.",
  EntriesClosed: "Entries for this competition just closed.",
  NotOpen: "This competition isn't accepting entries anymore.",
  CompetitionFull: "This competition is full.",
  ArtistAffiliated: "Artists and their teams can't enter their own competitions.",
  TransferFailed: "The payment didn't go through. Check your balance and try again.",
};

export function friendlyError(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? "";
      return FRIENDLY[name] ?? "The contract rejected this entry.";
    }
    if (/insufficient funds|exceeds balance/i.test(err.message)) return "Your balance is too low for this entry.";
    if (/rejected|denied/i.test(err.message)) return "The transaction was cancelled.";
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export async function enterCompetition(opts: {
  walletClient: WalletClient;
  competitionId: number;
  prediction: bigint;
  entryFee: bigint;
  onStep?: (step: EnterStep) => void;
}): Promise<`0x${string}`> {
  const { walletClient, competitionId, prediction, entryFee, onStep } = opts;
  const account = walletClient.account;
  const competition = config.competition;
  if (!account) throw new Error("Sign in first");
  if (!competition) throw new Error("NEXT_PUBLIC_COMPETITION_ADDRESS is not set");
  const player = account.address as Address;

  // 1. Approve, only if needed.
  const allowance = await publicClient.readContract({
    address: config.usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [player, competition],
  });
  if (allowance < entryFee) {
    onStep?.("approve");
    const hash = await walletClient.writeContract({
      account,
      chain,
      address: config.usdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [competition, entryFee],
      ...(await fees()),
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  // 2. Enter. Simulating first surfaces AlreadyEntered / EntriesClosed / etc. before paying gas.
  onStep?.("enter");
  const call = {
    address: competition,
    abi: competitionAbi,
    functionName: "enter",
    args: [BigInt(competitionId), prediction],
  } as const;
  await publicClient.simulateContract({ ...call, account });
  const hash = await walletClient.writeContract({ ...call, account, chain, ...(await fees()) });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Your entry didn't go through. Please try again.");
  onStep?.("done");
  return hash;
}
