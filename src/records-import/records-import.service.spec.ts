import { RecordsImportService } from './records-import.service';

describe('RecordsImportService', () => {
  const createService = () => {
    const sessionsService = {
      findOne: jest.fn().mockResolvedValue({ id: 's1' }),
      incrementMessageCount: jest.fn().mockResolvedValue({ id: 's1' }),
      updateSummary: jest.fn(),
      updateImportProfile: jest.fn(),
    };
    const messagesService = {
      createMany: jest.fn().mockImplementation(async (inputs) =>
        inputs.map((input: { role: 'user' | 'assistant'; content: string }, index: number) => ({
          id: index + 1,
          role: input.role,
          content: input.content,
        })),
      ),
    };
    const memoriesService = {
      addMemoryByText: jest.fn(),
    };
    const llmService = {
      chat: jest.fn(),
    };
    const jiwenEmotionService = {
      analyze: jest.fn().mockReturnValue({ dominant: 'neutral' }),
    };

    const service = new RecordsImportService(
      sessionsService as never,
      messagesService as never,
      memoriesService as never,
      llmService as never,
      jiwenEmotionService as never,
    );

    return { service, messagesService };
  };

  it('queues profile extraction by default after importing WeChat records', async () => {
    const originalSetImmediate = global.setImmediate;
    global.setImmediate = jest.fn() as unknown as typeof setImmediate;

    try {
      const { service, messagesService } = createService();
      const result = await service.importChatRecords({
        sessionId: 's1',
        text: '2026-06-04 21:18:03 me\nI feel tired\n2026-06-04 21:19:03 assistant\nI will stay with you',
      });

      expect(result.inserted).toBe(2);
      expect(result.profileExtractionQueued).toBe(true);
      expect(messagesService.createMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'I feel tired' }),
          expect.objectContaining({ role: 'assistant', content: 'I will stay with you' }),
        ]),
      );
    } finally {
      global.setImmediate = originalSetImmediate;
    }
  });

  it('parses fenced profile JSON safely', () => {
    const { service } = createService();
    const parser = service as unknown as {
      parseImportProfile(raw: string, messageCount: number): {
        userPersona?: { stableFacts?: string[] };
        relationshipProfile?: { closenessLevel?: string };
        evidence?: { source?: string; messageCount?: number };
      } | null;
    };

    const raw = [
      '~~~json'.replace(/~/g, '`'),
      '{',
      '  "userPersona": {',
      '    "stableFacts": ["user is learning an AI project"],',
      '    "preferences": [],',
      '    "communicationStyle": [],',
      '    "emotionalPatterns": [],',
      '    "boundaries": []',
      '  },',
      '  "relationshipProfile": {',
      '    "relationshipTone": "trusted",',
      '    "closenessLevel": "high",',
      '    "trustSignals": [],',
      '    "recurringTopics": [],',
      '    "supportNeeds": [],',
      '    "assistantRole": "technical companion"',
      '  }',
      '}',
      '~~~'.replace(/~/g, '`'),
    ].join('\n');

    const profile = parser.parseImportProfile(raw, 12);

    expect(profile?.userPersona?.stableFacts).toEqual(['user is learning an AI project']);
    expect(profile?.relationshipProfile?.closenessLevel).toBe('high');
    expect(profile?.evidence).toEqual(
      expect.objectContaining({ source: 'import', messageCount: 12 }),
    );
  });
});
