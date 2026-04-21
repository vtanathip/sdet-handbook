export type ActionType =
  | 'click'
  | 'fill'
  | 'select'
  | 'hover'
  | 'scroll'
  | 'wait'
  | 'assert_text'
  | 'assert_visible'
  | 'chart_hover'
  | 'chart_click'
  | 'iframe_action'
  | 'keyboard';

export interface ResolvedAction {
  type: ActionType;
  locatorStrategy: 'css' | 'xpath' | 'text' | 'role' | 'label' | 'coordinates';
  locator: string;
  value?: string;
  /** Set when the target element lives inside an iframe */
  frameSelector?: string;
  /** Used for canvas/chart pixel-level interactions */
  coordinates?: { x: number; y: number };
  /** 0–1 confidence score from the model */
  confidence: number;
  /** One-sentence explanation of why this locator was chosen */
  reasoning: string;
  /** Ordered fallbacks tried if the primary locator fails */
  fallbackLocators?: string[];
}

export interface StepResult {
  stepIndex: number;
  stepText: string;
  resolvedAction: ResolvedAction;
  status: 'passed' | 'failed' | 'skipped';
  errorMessage?: string;
  aiConfidence: number;
  aiReasoning: string;
  /** true means the locator was served from cache — no AI call was made */
  cacheHit: boolean;
  startTime: number;
  durationMs: number;
}

export interface TestSuiteReport {
  suiteName: string;
  startTime: number;
  totalDurationMs: number;
  steps: StepResult[];
  overallStatus: 'passed' | 'failed';
}
