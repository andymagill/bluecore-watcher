// Reads/writes the committed acknowledgements file — ADR-012. Single-use:
// a matching entry is consumed (removed) the run it's applied.
import { readFile, writeFile } from "node:fs/promises";
import { AcknowledgementsFile, type Acknowledgement } from "../contract/acknowledgements.js";

export class AcknowledgementStore {
  private constructor(
    private readonly path: string,
    private acknowledgements: Acknowledgement[],
  ) {}

  static async load(path: string): Promise<AcknowledgementStore> {
    let acknowledgements: Acknowledgement[] = [];
    try {
      const raw = JSON.parse(await readFile(path, "utf-8"));
      acknowledgements = AcknowledgementsFile.parse(raw).acknowledgements;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return new AcknowledgementStore(path, acknowledgements);
  }

  /** Returns the matching acknowledgement without consuming it — callers consume explicitly once the candidate actually publishes. */
  find(targetId: string, extractorKey: string, contentHash: string): Acknowledgement | null {
    return (
      this.acknowledgements.find(
        (a) =>
          a.targetId === targetId &&
          a.extractorKey === extractorKey &&
          a.contentHash === contentHash,
      ) ?? null
    );
  }

  consume(ack: Acknowledgement): void {
    this.acknowledgements = this.acknowledgements.filter((a) => a !== ack);
  }

  async save(): Promise<void> {
    const file = AcknowledgementsFile.parse({
      schemaVersion: 1,
      acknowledgements: this.acknowledgements,
    });
    await writeFile(this.path, JSON.stringify(file, null, 2) + "\n", "utf-8");
  }
}
