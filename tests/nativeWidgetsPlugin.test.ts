import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// A prebuild without --clean keeps the HyperWidgets target it made before;
// files added to the extension since then must still join its build.

type Entry = { value: string; comment: string };
type Project = {
  hash: { project: { objects: Record<string, Record<string, unknown>> } };
  generateUuid: () => string;
  pbxFileReferenceSection: () => Record<string, unknown>;
  pbxBuildFileSection: () => Record<string, unknown>;
  pbxGroupByName: (name: string) => { children: Entry[] } | null;
};
type Target = { buildPhases: Entry[] };

const { addMissingWidgetFiles } = createRequire(import.meta.url)('../native/plugins/withHyperWidgets.js') as {
  addMissingWidgetFiles: (project: Project, target: Target, files: string[]) => void;
};

function fakeProject({ group = true } = {}) {
  const objects = {
    PBXGroup: { G: { children: [{ value: 'a', comment: 'A.swift' }, { value: 'p', comment: 'Info.plist' }] } } as Record<string, { children: Entry[] }>,
    PBXSourcesBuildPhase: { S: { files: [{ value: 'b', comment: 'A.swift in Sources' }] } } as Record<string, { files: Entry[] }>,
    PBXResourcesBuildPhase: { R: { files: [] } } as Record<string, { files: Entry[] }>,
    PBXFileReference: {} as Record<string, unknown>,
    PBXBuildFile: {} as Record<string, unknown>,
  };
  let next = 0;
  const project: Project = {
    hash: { project: { objects } },
    generateUuid: () => `uuid${(next += 1)}`,
    pbxFileReferenceSection: () => objects.PBXFileReference,
    pbxBuildFileSection: () => objects.PBXBuildFile,
    pbxGroupByName: (name) => (group && name === 'HyperWidgets' ? objects.PBXGroup.G : null),
  };
  const target: Target = { buildPhases: [{ value: 'S', comment: 'Sources' }, { value: 'F', comment: 'Frameworks' }, { value: 'R', comment: 'Resources' }] };
  const comments = (entries: Entry[]) => entries.map((entry) => entry.comment);
  return {
    project,
    target,
    objects,
    children: () => comments(objects.PBXGroup.G.children),
    sources: () => comments(objects.PBXSourcesBuildPhase.S.files),
    resources: () => comments(objects.PBXResourcesBuildPhase.R.files),
  };
}

const FILES = ['A.swift', 'B.swift', 'Info.plist', 'Font.ttf'];

describe('addMissingWidgetFiles', () => {
  it('adds a new Swift file to Sources, a font to Resources, and lists a plist only', () => {
    const fake = fakeProject();
    addMissingWidgetFiles(fake.project, fake.target, FILES);
    expect(fake.sources()).toEqual(['A.swift in Sources', 'B.swift in Sources']);
    expect(fake.resources()).toEqual(['Font.ttf in Resources']);
    expect(fake.children()).toEqual(['A.swift', 'Info.plist', 'B.swift', 'Font.ttf']);
    const references = Object.entries(fake.objects.PBXFileReference).filter(([key]) => !key.endsWith('_comment'));
    expect(references.map(([, value]) => (value as { path: string }).path)).toEqual(['"B.swift"', '"Font.ttf"']);
  });

  it('changes nothing the second time', () => {
    const fake = fakeProject();
    addMissingWidgetFiles(fake.project, fake.target, FILES);
    const before = JSON.stringify(fake.objects);
    addMissingWidgetFiles(fake.project, fake.target, FILES);
    expect(JSON.stringify(fake.objects)).toBe(before);
  });

  it('leaves a project without the extension group alone', () => {
    const fake = fakeProject({ group: false });
    expect(() => addMissingWidgetFiles(fake.project, fake.target, FILES)).not.toThrow();
    expect(fake.sources()).toEqual(['A.swift in Sources']);
  });
});
