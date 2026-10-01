/**
 * Unit Tests: 3-Plane Observational Issue Triage & Priority Rubric
 */

import { describe, expect, it } from 'vitest';
import { triageIssueBody } from '../../src/triage/issue-parser';

describe('3-Plane Observational Issue Triage Parser', () => {
  it('correctly triages Plane 1 Lead Owner issue with priority 5', () => {
    const body = `
### Observational Plane
**Plane 1: Lead Owner / Developer (Priorities 1–20)**

### Priority Rating
**5 (Priority P5)**

### Human-Understandable Summary
Specification for 3-Plane Human Observational Issue System.
`;

    const result = triageIssueBody(body);
    expect(result.isObservational).toBe(true);
    expect(result.plane).toBe(1);
    expect(result.priority).toBe(5);
    expect(result.labels).toContain('observational-issue');
    expect(result.labels).toContain('proposal');
    expect(result.labels).toContain('plane:lead-owner');
    expect(result.labels).toContain('priority:p5');
  });

  it('correctly triages Plane 2 Collaborator issue without getting tricked by "Lead Owner" mentions', () => {
    const body = `
### Contributor Plane

Plane 2: Approved Collaborator (Priorities 20–40)

### Priority Rating (1–100)

25

### Human-Understandable Summary
Reporting this observation to the Lead Owner for architectural guidance.
`;

    const result = triageIssueBody(body);
    expect(result.isObservational).toBe(true);
    expect(result.plane).toBe(2);
    expect(result.priority).toBe(25);
    expect(result.labels).toContain('plane:collaborator');
    expect(result.labels).not.toContain('plane:lead-owner');
    expect(result.labels).toContain('priority:p25');
  });

  it('correctly triages Plane 3 Community issue without getting tricked by "Lead Owner" mentions', () => {
    const body = `
### Contributor Plane

Plane 3: Community / External Contributor (Priorities 40–100)

### Priority Rating (1–100)

75

### Human-Understandable Summary
Community observer note: noticed documentation drift when Lead Owner pushed updates.
`;

    const result = triageIssueBody(body);
    expect(result.isObservational).toBe(true);
    expect(result.plane).toBe(3);
    expect(result.priority).toBe(75);
    expect(result.labels).toContain('plane:community');
    expect(result.labels).not.toContain('plane:lead-owner');
    expect(result.labels).toContain('priority:p75');
  });

  it('clamps out-of-range priority values to the respective plane rubric bounds', () => {
    // Plane 1: range 1..20
    const p1High = triageIssueBody(`
### Contributor Plane
Plane 1: Lead Owner / Developer
### Priority Rating
80
`);
    expect(p1High.priority).toBe(20);
    expect(p1High.labels).toContain('priority:p20');

    const p1Low = triageIssueBody(`
### Contributor Plane
Plane 1: Lead Owner / Developer
### Priority Rating
0
`);
    // 0 is not 1-100, if not matched fallback or if matched clamped
    expect(p1Low.plane).toBe(1);

    // Plane 2: range 20..40
    const p2Low = triageIssueBody(`
### Contributor Plane
Plane 2: Approved Collaborator
### Priority Rating
10
`);
    expect(p2Low.priority).toBe(20);
    expect(p2Low.labels).toContain('priority:p20');

    const p2High = triageIssueBody(`
### Contributor Plane
Plane 2: Approved Collaborator
### Priority Rating
90
`);
    expect(p2High.priority).toBe(40);
    expect(p2High.labels).toContain('priority:p40');

    // Plane 3: range 40..100
    const p3Low = triageIssueBody(`
### Contributor Plane
Plane 3: Community / External Contributor
### Priority Rating
15
`);
    expect(p3Low.priority).toBe(40);
    expect(p3Low.labels).toContain('priority:p40');
  });

  it('skips non-observational regular issues', () => {
    const body = `
### Bug Report
Standard bug report without observational planes or proposals.
`;
    const result = triageIssueBody(body);
    expect(result.isObservational).toBe(false);
    expect(result.labels).toHaveLength(0);
  });
});
