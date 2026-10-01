/**
 * Observational Issue & Plane Triage Parser
 *
 * Implements the 3-plane triage logic:
 * - Plane 1 (Lead Owner / Developer): Priority 1–20 (labels: plane:lead-owner, priority:p1..p20)
 * - Plane 2 (Approved Collaborator): Priority 20–40 (labels: plane:collaborator, priority:p20..p40)
 * - Plane 3 (Community / External): Priority 40–100 (labels: plane:community, priority:p40..p100)
 */

export interface TriageResult {
  isObservational: boolean;
  plane: 1 | 2 | 3 | null;
  priority: number | null;
  labels: string[];
}

export function triageIssueBody(body: string, existingLabels: string[] = []): TriageResult {
  const isObservational =
    existingLabels.includes('observational-issue') ||
    body.includes('Contributor Plane') ||
    body.includes('Observational Plane') ||
    body.includes('plane:lead-owner') ||
    body.includes('plane:collaborator') ||
    body.includes('plane:community');

  if (!isObservational) {
    return {
      isObservational: false,
      plane: null,
      priority: null,
      labels: [],
    };
  }

  const labelsToAdd = new Set<string>();
  labelsToAdd.add('observational-issue');
  labelsToAdd.add('proposal');

  // 1. Detect Plane from plane section
  let plane: 1 | 2 | 3 | null = null;
  const planeSectionMatch = body.match(
    /(?:###\s*(?:Contributor|Observational)\s*Plane|Plane:?)[^\n]*\n+([^\n#]+)/i
  );
  const planeTarget = planeSectionMatch ? planeSectionMatch[1] : '';

  if (
    planeTarget.includes('Plane 1') ||
    planeTarget.includes('Lead Owner') ||
    (!planeSectionMatch && (body.includes('plane:lead-owner') || body.includes('Plane 1:')))
  ) {
    plane = 1;
    labelsToAdd.add('plane:lead-owner');
  } else if (
    planeTarget.includes('Plane 2') ||
    planeTarget.includes('Collaborator') ||
    (!planeSectionMatch && (body.includes('plane:collaborator') || body.includes('Plane 2:')))
  ) {
    plane = 2;
    labelsToAdd.add('plane:collaborator');
  } else if (
    planeTarget.includes('Plane 3') ||
    planeTarget.includes('Community') ||
    (!planeSectionMatch && (body.includes('plane:community') || body.includes('Plane 3:')))
  ) {
    plane = 3;
    labelsToAdd.add('plane:community');
  } else {
    // Fallback heuristic if section header not found
    if (body.match(/\b(?:Plane\s*1|Lead Owner)\b/i)) {
      plane = 1;
      labelsToAdd.add('plane:lead-owner');
    } else if (body.match(/\b(?:Plane\s*2|Collaborator)\b/i)) {
      plane = 2;
      labelsToAdd.add('plane:collaborator');
    } else if (body.match(/\b(?:Plane\s*3|Community)\b/i)) {
      plane = 3;
      labelsToAdd.add('plane:community');
    }
  }

  // 2. Parse Priority Rating (1-100)
  const prioritySectionMatch = body.match(
    /(?:###\s*Priority\s*Rating[^\n]*|Priority Rating[^\n:]*:?)\s*\n*([^\n#]+)/i
  );
  let pVal: number | null = null;

  if (prioritySectionMatch) {
    const numMatch = prioritySectionMatch[1].match(/\b([1-9][0-9]?|100)\b/);
    if (numMatch) {
      pVal = parseInt(numMatch[1], 10);
    }
  }

  if (pVal === null) {
    const explicitMatch = body.match(/\b(?:priority:p|Priority\s*P|P)([1-9][0-9]?|100)\b/i);
    if (explicitMatch) {
      pVal = parseInt(explicitMatch[1], 10);
    }
  }

  if (pVal !== null) {
    if (plane === 1) {
      pVal = Math.max(1, Math.min(20, pVal));
    } else if (plane === 2) {
      pVal = Math.max(20, Math.min(40, pVal));
    } else if (plane === 3) {
      pVal = Math.max(40, Math.min(100, pVal));
    } else {
      pVal = Math.max(1, Math.min(100, pVal));
    }
    labelsToAdd.add(`priority:p${pVal}`);
  }

  return {
    isObservational: true,
    plane,
    priority: pVal,
    labels: Array.from(labelsToAdd),
  };
}
