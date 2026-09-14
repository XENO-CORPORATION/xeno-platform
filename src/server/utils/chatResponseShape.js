/**
 * Shape the model's raw completion into the response the chat client expects.
 *
 * ## Why this is a module
 *
 * `/api/chat/generate` produced `answer` / `thinking` / `reasoningProcessed` / `modelIdUsed`
 * inline, and nothing else did. Measured 2026-09-14: the chat client reads 13 fields off the
 * response and `/api/ai/chat/stream` produced 5 — so that route could not serve a chat turn
 * without the client losing reasoning display, thinking panes and model attribution.
 *
 * 🔴 MOVED VERBATIM, not retyped. This is ~190 lines of model-SPECIFIC handling: Qwen and
 * DeepSeek-R1 emit reasoning in a separate field, sometimes with the answer duplicated inside
 * it, sometimes with an empty content field and the answer trailing the thinking after a blank
 * line. Every branch was earned against a real model behaving badly. Retyping is how a subtle
 * case silently stops working — and the failure is invisible, because the turn still answers,
 * it just shows the wrong half.
 *
 * ⚠️ The first extraction attempt cut this block at the last `finalResponse` assignment and
 * produced UNBALANCED braces — the shaping is one `if/else` spanning both reasoning states, so
 * the "obvious" end is inside the chain. Worth knowing before anyone re-cuts it.
 *
 * Proven equivalent to the inline version across a corpus before the swap.
 */
import { cleanTextContent } from './chatMessageParts.js';
import { reasoningCapabilityForModel } from '../lib/chatModelCapabilities.js';

/**
 * @param {object}  o
 * @param {object}  o.data                     the upstream `{ choices, usage }` response
 * @param {string}  o.outputText               assistant text, already extracted and cleaned
 * @param {string}  o.reasoningContent         the separate reasoning field, when the model sends one
 * @param {string}  o.selectedModelId          the model the caller asked for
 * @param {boolean} o.effectiveReasoningState  whether reasoning was requested for this turn
 * @returns {object} `{ answer, thinking, reasoningProcessed, modelIdUsed }` when reasoning was
 *   processed, else `{ text, modelIdUsed, reasoningProcessed: false }`. The caller adds
 *   searchInfo, usage, projectContextId and the image fields.
 */
export function shapeChatResponse({
  data,
  outputText,
  reasoningContent = '',
  selectedModelId,
  effectiveReasoningState,
}) {
  let finalResponse = {};
  const modelIdUsed = selectedModelId; // Use the requested ID

  // Check if the model is excluded from marker instructions
  const modelsToExcludeMarkers = [
      'anthropic/claude-3.5-sonnet',
      'deepseek/deepseek-chat-v3-0324:free'
  ];
  const isModelExcluded = modelsToExcludeMarkers.some(excludedModel => selectedModelId.includes(excludedModel));

  // If model is excluded, treat as if reasoning is disabled regardless of effectiveReasoningState
  const effectiveReasoningForResponse = effectiveReasoningState && !isModelExcluded;

  if (effectiveReasoningForResponse) {
      console.log(`Handling response with effectiveReasoningState: TRUE for ${modelIdUsed}`);
      // Reasoning was requested for this call.
      // Check for special fields first (Qwen/Deepseek R1/Gemini Pro/Grok/Claude 3.7)
      // Models that may return reasoning in a separate field
      const modelProvidesSeparateReasoning = reasoningCapabilityForModel(selectedModelId) !== 'disabled';

      if (modelProvidesSeparateReasoning) {
          const reasoningContent = data.choices?.[0]?.message?.reasoning;
          const answerContent = outputText; // Uses the already cleaned outputText

          if (reasoningContent) {
              console.log(`   -> Using separate 'reasoning' field from OpenRouter.`);

              try {
                  // Initial processing: convert literal \n, assign to working vars
                  let processedThinking = (reasoningContent || '').replace(/\\n/g, '\n');
                  let processedAnswer = (data.choices?.[0]?.message?.content || '').replace(/\\n/g, '\n');

                  // 1. Clean known malformed/standard think tags from processedThinking FIRST
                  processedThinking = processedThinking
                      .replace(/<\/\s*th\.\s*ink\s*>/gi, '') // For specific </th.\ink>
                      .replace(/<\/\s*think\s*>/gi, '')      // For standard </think>
                      .replace(/<\s*think\s*>/gi, '')         // For standard <think>
                      .trim();

                  // 2. Refined logic to separate thinking and answer
                  const tempThinkingTrimmed = processedThinking.trim(); // Use already tag-cleaned thinking
                  const tempAnswerTrimmed = processedAnswer.trim();

                  if (tempAnswerTrimmed.length > 0 && tempThinkingTrimmed.endsWith(tempAnswerTrimmed)) {
                      // Case 1: Answer from content field is present and is a suffix of thinking. Clean thinking.
                      let potentialThinkingOnly = tempThinkingTrimmed.substring(0, tempThinkingTrimmed.length - tempAnswerTrimmed.length).trim();
                      if (tempThinkingTrimmed !== tempAnswerTrimmed) { // Avoid emptying if thinking was *only* the answer
                          processedThinking = potentialThinkingOnly;
                          console.log(`   -> Cleaned duplicated answer (from content field) from thinking content.`);
                      }
                      // processedAnswer remains tempAnswerTrimmed (or rather, will be set from it)
                  } else if (tempAnswerTrimmed.length === 0 && tempThinkingTrimmed.length > 0) {
                      // Case 2: Answer from content field is empty, but thinking field has content.
                      // Attempt to split thinking into actual_thinking and actual_answer (common Qwen pattern).
                      const parts = tempThinkingTrimmed.split(/\n\n+/); // Split by 2 or more newlines
                      if (parts.length > 1) {
                          const potentialAnswerFromThinking = parts.pop().trim(); // Last part is potential answer
                          const potentialThinkingFromBody = parts.join('\n\n').trim(); // Rest is potential thinking

                          if (potentialAnswerFromThinking.length > 0) {
                              processedThinking = potentialThinkingFromBody;
                              processedAnswer = potentialAnswerFromThinking; // Overwrite empty processedAnswer
                              console.log(`   -> Extracted answer from thinking field as content field was empty/irrelevant.`);
                          } else {
                              // Splitting didn't yield a usable answer, thinking might be just thoughts.
                              console.log(`   -> Content field empty, and could not extract distinct answer from thinking. Thinking remains as is.`);
                          }
                      } else {
                           // No clear \n\n split, thinking might be just thoughts.
                           console.log(`   -> Content field empty, no clear \n\n split in thinking. Thinking remains as is.`);
                      }
                  }
                  // If none of the above, processedThinking and processedAnswer retain their current values.

                  // 3. Apply other specific cleanups (quotes, leading backslash)
                  // These apply to the potentially modified processedThinking and processedAnswer
                  processedThinking = processedThinking.replace(/^\\(\s*)/, '$1');
                  processedAnswer = processedAnswer.replace(/^\\(\s*)/, '$1');

                  // Clean specific leading quote pattern from answer (e.g., \"\n)
                  if (processedAnswer.startsWith('\"\n')) { 
                      processedAnswer = processedAnswer.substring(3);
                  }
                  // Remove general outer quotes from answer
                  processedAnswer = processedAnswer.replace(/^\s*["'](.*)["']\s*$/s, '$1').trim();

                  // 4. Apply final general cleaning (collapse newlines, final trim, markdown emphasis)
                  let finalThinking = cleanTextContent(processedThinking);
                  let finalAnswer = cleanTextContent(processedAnswer);

                  // Validate that we have meaningful content after processing
                  if (!finalThinking || finalThinking.trim().length === 0) {
                      console.warn(`   -> WARNING: Thinking content became empty after processing, falling back to raw reasoning`);
                      finalThinking = reasoningContent.trim();
                  }

                  if (!finalAnswer || finalAnswer.trim().length === 0) {
                      console.warn(`   -> WARNING: Answer content became empty after processing, falling back to raw content`);
                      finalAnswer = (data.choices?.[0]?.message?.content || '').trim();
                  }

                  console.log("   -> Final Qwen/DS-R1 thinking to send:", finalThinking);
                  console.log("   -> Final Qwen/DS-R1 answer to send:", finalAnswer);

                  finalResponse = { 
                      thinking: finalThinking,
                      answer: finalAnswer,
                      modelIdUsed: modelIdUsed,
                      reasoningProcessed: true  // Indicate that reasoning was processed
                  };
              } catch (processingError) {
                  console.error(`   -> ERROR processing reasoning field for ${modelIdUsed}:`, processingError);
                  console.log(`   -> Falling back to raw text due to processing error`);

                  // Fallback to raw text when reasoning processing fails
                  finalResponse = { 
                      text: outputText.trim(), 
                      modelIdUsed: modelIdUsed, 
                      reasoningProcessed: false,
                      error: "reasoning_processing_failed"
                  };
              }
          } else {
              // Model *should* provide reasoning field but didn't. Fallback to raw text.
              console.warn(`   -> ${modelIdUsed} did not provide 'reasoning' field. Sending raw text.`);

              // Enhanced error handling for Qwen3 models
              if (selectedModelId.includes('qwen/')) {
                  console.log(`   -> Qwen model detected, applying enhanced error handling`);

                  // Check if outputText contains any content
                  if (!outputText || outputText.trim().length === 0) {
                      console.error(`   -> ERROR: Qwen model returned empty response`);
                      finalResponse = { 
                          text: "Error: The model returned an empty response. Please try again.", 
                          modelIdUsed: modelIdUsed, 
                          reasoningProcessed: false,
                          error: "empty_response"
                      };
                  } else {
                      // Try to extract meaningful content from the response
                      let cleanedText = outputText.trim();

                      // Remove any malformed XML tags that might be present
                      cleanedText = cleanedText.replace(/<[^>]*>/g, '').trim();

                      // Remove any remaining malformed thinking tags
                      cleanedText = cleanedText
                          .replace(/<\/\s*th\.\s*ink\s*>/gi, '')
                          .replace(/<\/\s*think\s*>/gi, '')
                          .replace(/<\s*think\s*>/gi, '')
                          .trim();

                      if (cleanedText.length === 0) {
                          console.error(`   -> ERROR: Qwen model response became empty after cleaning`);
                          finalResponse = { 
                              text: "Error: The model response could not be processed properly. Please try again.", 
                              modelIdUsed: modelIdUsed, 
                              reasoningProcessed: false,
                              error: "processing_failed"
                          };
                      } else {
                          console.log(`   -> Successfully cleaned Qwen response, length: ${cleanedText.length}`);
                          finalResponse = { 
                              text: cleanedText, 
                              modelIdUsed: modelIdUsed, 
                              reasoningProcessed: false 
                          };
                      }
                  }
              } else {
                  // Non-Qwen models use standard fallback
                  finalResponse = { 
                      text: outputText.trim(), 
                      modelIdUsed: modelIdUsed, 
                      reasoningProcessed: false 
                  };
              }
          }
      } else {
           // Model doesn't use separate fields (Gemini, Grok, OpenAI, etc.)
           // Send the raw text, frontend parser will handle markers.
           console.log(`   -> Model uses markers. Sending raw text for frontend parsing.`);
           finalResponse = { text: outputText.trim(), modelIdUsed: modelIdUsed, reasoningProcessed: true }; // outputText is already cleaned
      }
  } else {
       // Reasoning was FALSE for this call OR model is excluded from reasoning.
       if (effectiveReasoningState && isModelExcluded) {
           console.log(`Handling response with effectiveReasoningState: TRUE for ${modelIdUsed} - BUT model is excluded from marker instructions, treating as non-reasoning response`);
       } else {
           console.log(`Handling response with effectiveReasoningState: FALSE for ${modelIdUsed}`);
       }
       // Send only the raw text. Frontend will not parse.
       finalResponse = { text: outputText.trim(), modelIdUsed: modelIdUsed, reasoningProcessed: false }; // outputText is already cleaned
  }
  return finalResponse;
}
