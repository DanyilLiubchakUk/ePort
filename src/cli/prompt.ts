import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function promptLine(label: string): Promise<string> {
  if (!input.isTTY) {
    throw new Error(`${label} (non-interactive shell: pass the matching --flag)`);
  }

  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(label);
    return answer.trim();
  } finally {
    rl.close();
  }
}

export async function promptYesNo(question: string): Promise<boolean> {
  while (true) {
    const answer = (await promptLine(`${question} [y/N]: `)).toLowerCase();
    if (!answer || answer === "n" || answer === "no") {
      return false;
    }
    if (answer === "y" || answer === "yes") {
      return true;
    }
    console.log("Enter y or n");
  }
}

export async function promptChoice(
  question: string,
  choices: readonly string[],
): Promise<string> {
  if (!input.isTTY) {
    throw new Error(`${question} (non-interactive shell: pass named or quick)`);
  }

  console.log(question);
  choices.forEach((choice, index) => {
    console.log(`  ${index + 1}. ${choice}`);
  });

  while (true) {
    const answer = await promptLine("Choice: ");
    const asNumber = Number.parseInt(answer, 10);
    if (Number.isFinite(asNumber) && asNumber >= 1 && asNumber <= choices.length) {
      return choices[asNumber - 1]!;
    }
    const match = choices.find((choice) => choice.toLowerCase() === answer.toLowerCase());
    if (match) {
      return match;
    }
    console.log(`Enter 1-${choices.length} or one of: ${choices.join(", ")}`);
  }
}
