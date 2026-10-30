import { matchesAny, type GateConfig } from "./config";
import type { FileChange } from "./diff";

export interface Classification {
  /** Layers with changed files of their own. */
  touched: string[];
  /** Changed files under `sharedPaths`. */
  sharedFiles: string[];
  /** Layers whose checks run: the touched ones, or every layer when shared code changed. */
  layersToRun: string[];
  /** Each layer's own changed files (source and test files). */
  filesByLayer: Record<string, FileChange[]>;
}

export function classify(changes: FileChange[], config: GateConfig): Classification {
  const relevant = changes.filter((change) => !matchesAny(change.path, config.ignorePaths));

  const filesByLayer: Record<string, FileChange[]> = {};
  for (const [name, layer] of Object.entries(config.layers)) {
    const files = relevant.filter((change) => matchesAny(change.path, [...layer.paths, ...layer.testPaths]));
    if (files.length > 0) filesByLayer[name] = files;
  }

  const touched = Object.keys(filesByLayer);
  const sharedFiles = relevant.filter((change) => matchesAny(change.path, config.sharedPaths)).map((change) => change.path);
  const layersToRun = sharedFiles.length > 0 ? Object.keys(config.layers) : touched;

  return { touched, sharedFiles, layersToRun, filesByLayer };
}
