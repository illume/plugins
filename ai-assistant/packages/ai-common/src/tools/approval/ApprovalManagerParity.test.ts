/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolCall } from '../types';
import { inlineToolApprovalManager } from './InlineToolApprovalManager';
import { toolApprovalManager } from './ToolApprovalManager';

const calls: ToolCall[] = [
  {
    id: 'read-pod',
    name: 'kubernetes_api_request',
    arguments: { method: 'GET', path: '/api/v1/namespaces/demo/pods/web' },
    type: 'regular',
  },
  {
    id: 'patch-service',
    name: 'kubernetes_api_request',
    arguments: {
      method: 'PATCH',
      path: '/api/v1/namespaces/demo/services/web',
      body: [{ op: 'replace', path: '/spec/selector/tier', value: 'backend' }],
    },
    type: 'regular',
  },
];

function resetManagers(): void {
  inlineToolApprovalManager.clearSession();
  inlineToolApprovalManager.setApprovalHandler(null);
  inlineToolApprovalManager.setAutoApprovedServers([]);
  toolApprovalManager.clearSession();
  toolApprovalManager.setApprovalHandler(null);
}

describe('browser and CLI approval parity', () => {
  beforeEach(resetManagers);

  it('displays the same exact calls and resolves the same approved subset', async () => {
    const browserPromise = inlineToolApprovalManager.requestApproval(calls, { history: [] });
    const cliPromise = toolApprovalManager.requestApproval(calls);
    const browserRequest = inlineToolApprovalManager.getPendingRequest();
    const cliRequest = toolApprovalManager.getPendingRequest();

    expect(browserRequest?.toolCalls).toEqual(calls);
    expect(cliRequest?.toolCalls).toEqual(calls);
    inlineToolApprovalManager.approveTools(browserRequest!.requestId, ['patch-service']);
    toolApprovalManager.approveTools(cliRequest!.requestId, ['patch-service']);

    await expect(browserPromise).resolves.toEqual(['patch-service']);
    await expect(cliPromise).resolves.toEqual(['patch-service']);
  });

  it('makes denial terminal on both surfaces', async () => {
    const browserPromise = inlineToolApprovalManager.requestApproval(calls, { history: [] });
    const cliPromise = toolApprovalManager.requestApproval(calls);
    inlineToolApprovalManager.denyTools(
      inlineToolApprovalManager.getPendingRequest()!.requestId
    );
    toolApprovalManager.denyTools(toolApprovalManager.getPendingRequest()!.requestId);

    await expect(browserPromise).rejects.toThrow('User denied tool execution');
    await expect(cliPromise).rejects.toThrow('User denied tool execution');
  });

  it('remembers only the approved tool name on both surfaces', async () => {
    const browserPromise = inlineToolApprovalManager.requestApproval(calls, { history: [] });
    const cliPromise = toolApprovalManager.requestApproval(calls);
    inlineToolApprovalManager.approveTools(
      inlineToolApprovalManager.getPendingRequest()!.requestId,
      ['read-pod'],
      true
    );
    toolApprovalManager.approveTools(
      toolApprovalManager.getPendingRequest()!.requestId,
      ['read-pod'],
      true
    );
    await Promise.all([browserPromise, cliPromise]);

    expect(inlineToolApprovalManager.isSessionAutoApprovalEnabled()).toBe(false);
    expect(toolApprovalManager.isSessionAutoApprovalEnabled()).toBe(false);

    const nextCall = [{ ...calls[0], id: 'next-read' }];
    await expect(
      inlineToolApprovalManager.requestApproval(nextCall, { history: [] })
    ).resolves.toEqual(['next-read']);
    await expect(toolApprovalManager.requestApproval(nextCall)).resolves.toEqual(['next-read']);
    expect(inlineToolApprovalManager.getPendingRequest()).toBeNull();
    expect(toolApprovalManager.getPendingRequest()).toBeNull();
  });
});