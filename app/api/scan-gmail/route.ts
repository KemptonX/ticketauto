import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";

export async function POST() {
  try {
    const scriptPath = "C:\\ticketmaster_bot\\gmail_to_excel.py";
    const workingDirectory = "C:\\ticketmaster_bot";

    let command = "python";
    let args = [scriptPath];

    try {
      await execFileAsync(command, args, {
        cwd: workingDirectory,
        timeout: 120000,
      });
    } catch {
      command = "py";
      args = [scriptPath];
      await execFileAsync(command, args, {
        cwd: workingDirectory,
        timeout: 120000,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown scan error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
