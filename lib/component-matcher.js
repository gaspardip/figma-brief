import { HEURISTICS } from "./heuristics.js";

const FIGMA_PREFIXES = [
  "base_desktop_",
  "base_mobile_",
  "base_",
  "desktop_",
  "mobile_",
  "vuesax/linear/",
  "vuesax/bold/",
  "vuesax/outline/",
];

function normalize(name) {
  return String(name)
    .replace(/\s*\/\s*/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/[^a-z0-9\s]/gi, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function stripFigmaPrefixes(name) {
  const lower = name.toLowerCase();

  for (const prefix of FIGMA_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return name.slice(prefix.length);
    }
  }

  return name;
}

function longestCommonSubstringRatio(a, b) {
  if (!a || !b) {
    return 0;
  }

  const m = a.length;
  const n = b.length;
  let longest = 0;
  const prev = new Array(n + 1).fill(0);
  const curr = new Array(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        longest = Math.max(longest, curr[j]);
      } else {
        curr[j] = 0;
      }
    }

    for (let j = 0; j <= n; j++) {
      prev[j] = curr[j];
      curr[j] = 0;
    }
  }

  return longest / Math.max(m, n);
}

function wordsContainedIn(instanceWords, componentWords) {
  if (componentWords.length === 0 || instanceWords.length === 0) {
    return false;
  }

  return componentWords.every((w) => instanceWords.includes(w));
}

function makeMatch(component, confidence) {
  return {
    name: component.name,
    path: component.path,
    props: component.props ?? [],
    confidence,
  };
}

let compiledBlockPairs = null;

function getCompiledBlockPairs(blockPairs) {
  if (!compiledBlockPairs) {
    compiledBlockPairs = (blockPairs ?? []).map((pair) => ({
      pattern: new RegExp(pair.instancePattern, "i"),
      componentName: pair.componentName,
    }));
  }

  return compiledBlockPairs;
}

function isBlockedPair(instanceName, componentName, blockPairs) {
  for (const pair of getCompiledBlockPairs(blockPairs)) {
    if (
      pair.pattern.test(instanceName) &&
      componentName === pair.componentName
    ) {
      return true;
    }
  }

  return false;
}

function findBestMatch(instanceName, manifest) {
  const h = HEURISTICS.componentMatching;

  const stripped = stripFigmaPrefixes(instanceName);
  const namesToTry =
    stripped !== instanceName ? [instanceName, stripped] : [instanceName];

  for (const name of namesToTry) {
    const result = findBestMatchForName(name, manifest, h);

    if (
      result &&
      !isBlockedPair(instanceName, result.name, h.blockPairs ?? [])
    ) {
      return result;
    }
  }

  // Single-word leaf instances (after prefix strip) that didn't match anything
  // might be icons — match to "icon" component if it exists in manifest
  if (stripped !== instanceName) {
    const normalizedStripped = normalize(stripped);

    if (!normalizedStripped.includes(" ")) {
      const iconComponent = manifest.components.find(
        (c) => c.name === "icon" || c.name === "svg-icon",
      );

      if (iconComponent) {
        return makeMatch(iconComponent, 0.3);
      }
    }
  }

  return null;
}

function findBestMatchForName(instanceName, manifest, h) {
  const normalizedInstance = normalize(instanceName);
  const instanceWords = normalizedInstance.split(" ").filter(Boolean);

  for (const component of manifest.components) {
    if (normalize(component.name) === normalizedInstance) {
      return makeMatch(component, h.exactConfidence);
    }
  }

  for (const component of manifest.components) {
    for (const alias of component.aliases ?? []) {
      if (normalize(alias) === normalizedInstance) {
        return makeMatch(component, h.aliasConfidence);
      }
    }
  }

  for (const component of manifest.components) {
    const names = [component.name, ...(component.aliases ?? [])];

    for (const name of names) {
      const componentWords = normalize(name).split(" ").filter(Boolean);

      if (wordsContainedIn(instanceWords, componentWords)) {
        return makeMatch(component, h.wordContainmentConfidence);
      }
    }
  }

  let bestMatch = null;
  let bestRatio = 0;

  for (const component of manifest.components) {
    const names = [component.name, ...(component.aliases ?? [])];

    for (const name of names) {
      const ratio = longestCommonSubstringRatio(
        normalizedInstance,
        normalize(name),
      );

      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestMatch = component;
      }
    }
  }

  if (bestMatch && bestRatio >= h.fuzzyThreshold) {
    return makeMatch(
      bestMatch,
      Number((h.fuzzyMultiplier * bestRatio).toFixed(2)),
    );
  }

  return null;
}

export function matchComponents(instances, manifest) {
  if (
    !manifest ||
    !Array.isArray(manifest.components) ||
    manifest.components.length === 0
  ) {
    return [];
  }

  return instances.map((instance) => ({
    instanceId: instance.id,
    instanceName: instance.name,
    componentId: instance.componentId ?? null,
    match: findBestMatch(instance.name, manifest),
  }));
}
