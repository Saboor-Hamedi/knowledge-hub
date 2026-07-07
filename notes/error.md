 ERROR  [vite:esbuild] Transform failed with 1 error:
B:/electron/knowledgeHub/src/main/knm/extractor/chunker.ts:44:56: ERROR: Expected ";" but found ")"
file: B:/electron/knowledgeHub/src/main/knm/extractor/chunker.ts:44:56

Expected ";" but found ")"
42 |        flushCurrent()
43 |        // Split large paragraph by sentences
44 |        const sentences = para.match(/[^.!?\n]+[.!?]*\s*/g) || [para]
   |                                                          ^
45 |        let sentBuf: string[] = 