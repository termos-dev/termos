import React, { useState, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import type { FormSchema, FormResult, FormOption } from "../types.js";
import { emitResult } from "../types.js";

interface Props {
  schema: FormSchema;
  title?: string;
}

interface SelectItem {
  label: string;
  value: string;
}

type AnswerValue = string | string[];

export function SchemaForm({ schema, title }: Props) {
  const { exit } = useApp();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [multiSelectState, setMultiSelectState] = useState<Set<string>>(new Set());
  const [multiSelectCursor, setMultiSelectCursor] = useState(0);
  const [textValue, setTextValue] = useState("");

  const currentQuestion = schema.questions[currentIndex];
  const isLastQuestion = currentIndex === schema.questions.length - 1;
  const isTextInput = !currentQuestion?.options;
  const isMultiSelect = currentQuestion?.multiSelect;

  const handleComplete = useCallback((result: FormResult) => {
    emitResult(result);
    exit();
  }, [exit]);

  const saveAndAdvance = useCallback((value: AnswerValue) => {
    const key = currentQuestion.header;
    const newAnswers = { ...answers, [key]: value };
    setAnswers(newAnswers);

    if (isLastQuestion) {
      handleComplete({ action: "accept", answers: newAnswers });
    } else {
      setCurrentIndex(currentIndex + 1);
      setTextValue("");
      setMultiSelectState(new Set());
      setMultiSelectCursor(0);
    }
  }, [answers, currentIndex, currentQuestion, isLastQuestion, handleComplete]);

  // Convert options to SelectInput format
  const selectItems: SelectItem[] = currentQuestion?.options?.map((opt: FormOption) => ({
    label: opt.label + (opt.description ? ` - ${opt.description}` : ""),
    value: opt.label,
  })) || [];

  // Handle keyboard input
  useInput((input, key) => {
    if (key.escape) {
      handleComplete({ action: "cancel" });
      return;
    }

    // Multi-select specific input handling
    if (isMultiSelect && selectItems.length > 0) {
      if (key.upArrow) {
        setMultiSelectCursor(prev => (prev - 1 + selectItems.length) % selectItems.length);
      } else if (key.downArrow) {
        setMultiSelectCursor(prev => (prev + 1) % selectItems.length);
      } else if (input === " ") {
        // Toggle selection
        const item = selectItems[multiSelectCursor];
        setMultiSelectState(prev => {
          const newSet = new Set(prev);
          if (newSet.has(item.value)) {
            newSet.delete(item.value);
          } else {
            newSet.add(item.value);
          }
          return newSet;
        });
      } else if (key.return) {
        saveAndAdvance(Array.from(multiSelectState));
      }
    }
  });

  // Handle text input submission
  const handleTextSubmit = useCallback((value: string) => {
    if (currentQuestion.validation) {
      const regex = new RegExp(currentQuestion.validation);
      if (!regex.test(value)) {
        // TODO: Show validation error
        return;
      }
    }
    saveAndAdvance(value);
  }, [currentQuestion, saveAndAdvance]);

  // Handle single-select selection
  const handleSelect = useCallback((item: SelectItem) => {
    saveAndAdvance(item.value);
  }, [saveAndAdvance]);

  if (!currentQuestion) {
    return <Text color="red">No questions in schema</Text>;
  }

  return (
    <Box flexDirection="column" padding={1}>
      {title && (
        <Box marginBottom={1}>
          <Text bold color="cyan">{title}</Text>
        </Box>
      )}

      {/* Progress indicator */}
      <Box marginBottom={1}>
        <Text dimColor>
          Question {currentIndex + 1} of {schema.questions.length}
        </Text>
      </Box>

      {/* Header/Label */}
      <Box marginBottom={1}>
        <Text bold color="yellow">[{currentQuestion.header}]</Text>
      </Box>

      {/* Question */}
      <Box marginBottom={1}>
        <Text>{currentQuestion.question}</Text>
      </Box>

      {/* Input area */}
      <Box marginBottom={1}>
        {isTextInput ? (
          <Box>
            <Text color="green">{"> "}</Text>
            <TextInput
              value={textValue}
              onChange={setTextValue}
              onSubmit={handleTextSubmit}
              placeholder={currentQuestion.placeholder || "Type your answer..."}
              mask={currentQuestion.inputType === "password" ? "*" : undefined}
            />
          </Box>
        ) : isMultiSelect ? (
          <Box flexDirection="column">
            {selectItems.map((item, idx) => (
              <Box key={item.value}>
                <Text color={idx === multiSelectCursor ? "cyan" : "white"}>
                  {idx === multiSelectCursor ? "> " : "  "}
                  {multiSelectState.has(item.value) ? "[x] " : "[ ] "}
                  {item.label}
                </Text>
              </Box>
            ))}
          </Box>
        ) : (
          <SelectInput
            items={selectItems}
            onSelect={handleSelect}
          />
        )}
      </Box>

      {/* Help text */}
      <Box marginTop={1}>
        <Text dimColor>
          {isTextInput
            ? "Press Enter to submit, Escape to cancel"
            : isMultiSelect
              ? "Use arrows to navigate, Space to toggle, Enter to confirm, Escape to cancel"
              : "Use arrows to select, Enter to confirm, Escape to cancel"
          }
        </Text>
      </Box>
    </Box>
  );
}
