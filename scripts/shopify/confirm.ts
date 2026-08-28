import { createInterface } from "node:readline/promises";

export function confirmationBypassed(args: string[] = process.argv.slice(2)): boolean {
  return args.includes("--yes") || process.env.CI === "1";
}

export async function confirmDestructive(message: string, args: string[] = process.argv.slice(2)): Promise<void> {
  if (confirmationBypassed(args)) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`${message} Re-run with --yes or CI=1.`);
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`${message} Type "yes" to continue: `);
    if (answer.trim().toLowerCase() !== "yes") throw new Error("Cancelled");
  } finally {
    prompt.close();
  }
}
