import { describe, expect, it } from 'vitest';
import type { SessionAccessGrantsListResponseV1 } from '@happier-dev/protocol';
import { projectSessionAccessEditorSnapshot, projectSessionAccessPrincipal } from './projectSessionAccessEditorSnapshot';

const capabilities = {readTranscript:true,submitAgentInput:true,editSessionRecords:true,approveRuntimePermissions:true,manageAccess:true,managePermissionDelegation:true,managePublicLink:true,archiveSession:true,renameSession:true,assignResponsibility:true,stopSession:true,deleteSession:true};
type CompleteSessionAccessSnapshot = Extract<SessionAccessGrantsListResponseV1, { visibility: 'complete' }>;

function snapshot(): CompleteSessionAccessSnapshot {
    return {visibility:'complete',owner:{kind:'account',accountId:'owner',firstName:'Owner',lastName:null,username:null,avatarUrl:null},primaryTeamId:null,effectiveAccess:{v:1,level:'owner',sources:[{kind:'owner'}],capabilities},grants:[{grant:{subject:{kind:'team',teamId:'team'},accessLevel:'view',canApprovePermissions:false,requiredByTeamPolicy:true},principal:{kind:'team',teamId:'team',name:'Acme'},allowedTransitions:{accessLevels:[],canChangePermissionDelegation:false,canRemove:false,reason:'session_access_team_policy_required'}}]};
}
describe('access editor server projection',()=>{
    it('honors admitted transitions independently from the caller owner level',()=>{
        const result=projectSessionAccessEditorSnapshot({snapshot:snapshot()});
        expect(result.grants[0]?.level.kind).toBe('locked');
        expect(result.grants[0]?.removal.kind).toBe('blocked');
        expect(result.grants[0]?.principal.displayName).toBe('Acme');
    });
    it('never labels an inspection-only response Private or reconstructs unrelated grants from access reasons',()=>{
        const original=snapshot();
        const result=projectSessionAccessEditorSnapshot({snapshot:{...original,visibility:'self',grants:[],effectiveAccess:{...original.effectiveAccess,level:'edit',sources:[{kind:'team',teamId:'team',requiredByTeamPolicy:false}],capabilities:{...capabilities,manageAccess:false}}}});
        expect(result.grants).toEqual([]);
        expect(result.accessMode).toBe('read_only');
        expect(result.summary.label).not.toBe('');
        expect(result.summary.label).not.toBe('Private');
    });
    it.each([
        ['view', { kind: 'direct', shareId: 'private-share-id' }, 'Direct access'],
        ['edit', { kind: 'team', teamId: 'private-team-id', requiredByTeamPolicy: false }, 'Team access'],
        ['admin', { kind: 'group', teamId: 'private-team-id', groupId: 'private-group-id' }, 'Group access'],
    ] as const)('projects truthful %s access from the applicable source without exposing server identifiers', (level, source, sourceLabel) => {
        const original = snapshot();
        const effectiveAccess = {
            ...original.effectiveAccess,
            level,
            sources: [source],
            capabilities: { ...capabilities, manageAccess: level === 'admin' },
        };
        const listed: SessionAccessGrantsListResponseV1 = level === 'admin'
            ? { ...original, effectiveAccess }
            : { ...original, visibility: 'self', grants: [], effectiveAccess };
        const result = projectSessionAccessEditorSnapshot({ snapshot: listed });

        expect(result.viewerAccess).toMatchObject({ level, sourceLabels: [sourceLabel] });
        expect(JSON.stringify(result.viewerAccess)).not.toContain('private-share-id');
        expect(JSON.stringify(result.viewerAccess)).not.toContain('private-team-id');
        expect(JSON.stringify(result.viewerAccess)).not.toContain('private-group-id');
    });
    it.each([
        ['session_access_subject_ineligible', 'This person, group, or team can no longer receive access.'],
        ['session_access_transcript_not_shareable', 'This session cannot be shared until its transcript is available.'],
        ['session_access_team_policy_required', 'Team policy requires this access.'],
    ] as const)('preserves the manager recovery for %s instead of flattening it to permission denied', (reason, message) => {
        const original = snapshot();
        const row = original.grants[0]!;
        const result = projectSessionAccessEditorSnapshot({ snapshot: {
            ...original,
            grants: [{
                ...row,
                allowedTransitions: {
                    accessLevels: [],
                    canChangePermissionDelegation: false,
                    canRemove: false,
                    reason,
                },
            }],
        } });

        expect(result.grants[0]?.level).toEqual({
            kind: 'locked',
            value: 'view',
            reason: { code: reason, message },
        });
        expect(result.grants[0]?.removal).toEqual({
            kind: 'blocked',
            reason: { code: reason, message },
        });
    });
    it.each([false, true] as const)('hides permission delegation on a View row even when the stored flag is %s', (canApprovePermissions) => {
        const original = snapshot();
        const row = original.grants[0]!;
        const result = projectSessionAccessEditorSnapshot({ snapshot: { ...original, grants: [
            // A View grant delegates nothing, so the manager who may change
            // delegation elsewhere still gets no control on this row.
            { ...row, grant: { ...row.grant, accessLevel: 'view', canApprovePermissions },
                allowedTransitions: { accessLevels: ['view', 'edit', 'admin'], canChangePermissionDelegation: true, canRemove: true } },
            { ...row, grant: { subject: { kind: 'account', accountId: 'alice' }, accessLevel: 'edit', canApprovePermissions: true },
                principal: { kind: 'account', accountId: 'alice', firstName: 'Alice', lastName: null, username: null, avatarUrl: null },
                allowedTransitions: { accessLevels: ['view', 'edit', 'admin'], canChangePermissionDelegation: true, canRemove: true } },
        ] } });

        expect(result.grants[0]?.permissionDelegation).toEqual({ kind: 'hidden' });
        expect(result.grants[1]?.permissionDelegation).toEqual({ kind: 'editable', value: true });
    });
    it('carries the safe Account display profile so a principal row can show its canonical avatar',()=>{
        const original=snapshot();
        const row=original.grants[0]!;
        const result=projectSessionAccessEditorSnapshot({snapshot:{...original,grants:[{
            ...row,
            grant:{subject:{kind:'account',accountId:'alice'},accessLevel:'view',canApprovePermissions:false},
            principal:{kind:'account',accountId:'alice',firstName:'Alice',lastName:null,username:'alice',avatarUrl:'https://cdn.example/alice.png'},
        }]}});

        expect(result.grants[0]?.principal.avatar).toEqual({id:'alice',imageUrl:'https://cdn.example/alice.png'});
        // An Account without an uploaded image still identifies itself; the Avatar
        // owner draws the fallback, so the row must not lose the avatar slot.
        expect(result.owner?.principal.avatar).toEqual({id:'owner'});
        // Teams and Groups have no Account profile at all; their kind glyph is the row's leading visual.
        expect(projectSessionAccessPrincipal({kind:'team',teamId:'acme',name:'Acme'}).avatar).toBeUndefined();
    });
    it('retains server acknowledged value while a row is saving',()=>{
        const result=projectSessionAccessEditorSnapshot({snapshot:snapshot(),operations:{'team:team':{kind:'saving'}}});
        expect(result.grants[0]?.level.value).toBe('view');
        expect(result.grants[0]?.operation.kind).toBe('saving');
    });
});
