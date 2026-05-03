// i18n: dictionary + lookup. Adding a new language means adding a new
// top-level entry to TRANSLATIONS and a button in LanguageToggle. Keys are
// dot-separated for grouping; missing keys fall back to English then the raw
// key. Params use `{name}` placeholders.

export const SUPPORTED_LANGUAGES = ['en', 'zh'];

export const LANGUAGE_LABELS = {
  en: 'EN',
  zh: '中文',
};

const EN = {
  // Header / output style toggle
  'header.outputStyle': 'Output style',
  'header.machineMode': 'Machine Mode',
  'header.humanMode': 'Human Mode',
  'header.machineModeTooltip': 'Long-form, highly rigorous output for agents.',
  'header.humanModeTooltip': 'Concise, human-readable output.',
  'header.machineModeAria': 'Machine mode: long-form, highly rigorous output for agents',
  'header.humanModeAria': 'Human mode: concise, human-readable output',

  // Language toggle
  'language.toggleAria': 'Switch language',
  'language.switchTo': 'Switch to {label}',

  // Ambient toggle
  'ambient.switchTo': 'Switch to {label} theme [{shortcut}]',
  'ambient.switchToAria': 'Switch to {label} theme',
  'ambient.light': 'Light',
  'ambient.dark': 'Dark',

  // Steps
  'step.setup': 'Setup',
  'step.draftReview': 'Draft & Review',
  'step.finalize': 'Finalize',

  // Mode toggle
  'mode.ideating': 'Ideating',
  'mode.draftMarket': 'Draft Market',

  // Draft form
  'form.question': '42.space Market Question',
  'form.questionPlaceholder': 'e.g., Which artist tops the Billboard Hot 100 year-end chart 2026?',
  'form.startDate': 'Start Date & Time',
  'form.endDate': 'End Date & Time',
  'form.utc': '(UTC)',
  'form.optional': '(optional)',
  'form.references': 'References',
  'form.referencesPlaceholder': 'Paste links or notes for the AI to reference, one per line...',
  'form.numberOfOutcomes': 'Number of Outcomes',
  'form.numberOfOutcomesPlaceholder': 'Leave blank to let the drafter choose',
  'form.draftingModel': 'Drafting Model',
  'form.drafting': 'Drafting...',
  'form.draftMarket': 'Draft Market',

  // Review form
  'form.pasteExistingDraft': 'Paste Existing Draft',
  'form.pasteExistingDraftPlaceholder': 'Paste your existing market draft here...',
  'form.submitForReview': 'Submit for Review',

  // Ideating form
  'form.vagueDirection': 'Vague Direction',
  'form.vagueDirectionPlaceholder': "Describe a rough area of interest — e.g., 'esports finals season 2026', 'upcoming awards races', 'memecoin narratives'. The model will brainstorm 42.space-shaped multi-outcome market ideas.",
  'form.ideationModel': 'Ideation Model',
  'form.ideating': 'Ideating...',
  'form.generateIdeas': 'Generate Ideas',

  // Ideas
  'ideas.heading': 'Market Ideas',
  'ideas.refresh': 'Refresh',
  'ideas.refreshTitle': 'Generate a fresh batch of 3 ideas',
  'ideas.refreshAria': 'Refresh ideas',
  'ideas.useTitle': 'Use this idea in Draft Market',
  'ideas.useAria': 'Use idea {n} in Draft Market',
  'ideas.fallbackTitle': 'Idea {n}',

  // Draft output
  'draft.heading': 'Draft',
  'draft.versionTitle': 'Version {current} of {total}',
  'draft.updated': 'Updated ',
  'draft.versionHistoryAria': 'Draft version history',
  'draft.previousVersion': 'Previous version',
  'draft.nextVersion': 'Next version',
  'draft.viewingEarlier': 'Viewing an earlier version (v{current} of {total})',
  'draft.jumpToLatest': 'Jump to latest',

  // Generic
  'common.copy': 'Copy',
  'common.copied': 'Copied!',
  'common.copyAll': 'Copy All',
  'common.dismiss': 'Dismiss',
  'common.justNow': 'just now',
  'common.secondsAgo': '{n}s ago',
  'common.minutesAgo': '{n}m ago',
  'common.hoursAgo': '{n}h ago',
  'common.modelAria': 'Model: {name}',
  'common.none': '(none)',

  // Panel placeholders
  'placeholder.draftReview': 'Complete setup and draft a market to continue',
  'placeholder.finalize': 'Draft, review, and update your market to finalize',

  // Action toolbar
  'toolbar.reviewCouncil': 'Review Council',
  'toolbar.removeReviewer': 'Remove reviewer',
  'toolbar.addReviewer': '+ Add Reviewer',
  'toolbar.councilHintMulti': 'Multiple reviewers will deliberate to produce a stronger critique',
  'toolbar.councilHintSingle': 'Deliberation needs at least two reviewers; add another model to compare',
  'toolbar.aggregation': 'Aggregation',
  'toolbar.aggMajority': 'Plurality vote per rubric item; ties escalate.',
  'toolbar.aggUnanimity': 'Every reviewer must agree; a single "no" fails the item.',
  'toolbar.aggJudge': 'A judge model reads all votes and renders the verdict.',
  'toolbar.councilChanged': 'Council changed; rerun review before updating.',
  'toolbar.review': 'Review',
  'toolbar.reviewAndDeliberate': 'Review & Deliberate',
  'toolbar.rerun': 'Re-run {action}',
  'toolbar.reviewing': 'Reviewing...',
  'toolbar.deliberating': 'Deliberating...',
  'toolbar.reviewAlreadyCurrent': 'This review already reflects the selected council. Update the draft or change the council to review again.',
  'toolbar.updateDraft': 'Update Draft',
  'toolbar.updating': 'Updating...',
  'toolbar.acceptFinalize': 'Accept & Finalize',
  'toolbar.finalizing': 'Finalizing...',
  'toolbar.acceptTitleConfigChanged': 'Rerun review with the selected council and update the draft before finalizing.',
  'toolbar.acceptTitleNeedsRiskAck': 'Acknowledge the HIGH early-resolution risk below before finalizing.',
  'toolbar.acceptTitleNeedsRoutingAck': 'Resolve or acknowledge the blocking claims flagged by the rigor pipeline before finalizing.',
  'toolbar.acceptTitleNeedsSourceAck': 'One or more data sources in the resolution rule are unreachable. Fix the sources and re-run Update, or acknowledge to finalize anyway.',

  // Risk gates — Early Resolution
  'gate.earlyLabel': 'Early-Resolution Risk',
  'gate.checking': 'Checking…',
  'gate.unknown': 'Unknown',
  'gate.high': 'HIGH',
  'gate.medium': 'MEDIUM',
  'gate.low': 'LOW',
  'gate.earlyWarning': 'This market may resolve before its end date. Acknowledge the risk to unlock Finalize, or revise the draft (e.g. add an explicit early-resolution clause, shorten the window, or tighten the outcome set).',
  'gate.earlyAck': 'Acknowledge HIGH risk & unlock Finalize',

  // Risk gates — Rigor Routing
  'gate.routingLabel': 'Rigor Routing',
  'gate.routingBlocked': 'BLOCKED',
  'gate.routingNeedsUpdate': 'NEEDS UPDATE',
  'gate.routingHint': "These checks verify that the draft's claims — resolution sources, rules, edge cases — are consistent and well-supported.",
  'gate.routingMustFix': 'Must fix before finalizing ({n}):',
  'gate.routingWorthReviewing': 'Worth reviewing ({n}):',
  'gate.routingAffectingOne': 'Affecting all {n} flagged claim:',
  'gate.routingAffectingMany': 'Affecting all {n} flagged claims:',
  'gate.routingClaimUnavailable': '(claim text unavailable)',
  'gate.routingWhyBlocked': 'Why it is blocked:',
  'gate.routingWarning': 'The draft is blocked because one or more claims have serious issues. Re-run Review → Update to fix them, or acknowledge to finalize anyway.',
  'gate.routingAck': 'Acknowledge blocking claims & unlock Finalize',

  // Risk gates — Source Accessibility
  'gate.sourceLabel': 'Data Source Accessibility',
  'gate.sourceReachable': 'REACHABLE',
  'gate.sourcePartial': 'PARTIAL',
  'gate.sourceAllUnreachable': 'ALL UNREACHABLE',
  'gate.sourceNoSources': 'NO SOURCES',
  'gate.sourceError': 'ERROR',
  'gate.sourceUnknown': 'UNKNOWN',
  'gate.sourceHint': 'Probes each data source in the resolution rule to confirm the oracle will actually be able to read it at settlement time. Unreachable sources risk a market that cannot resolve — fix them before finalizing.',
  'gate.sourceNoSourcesText': 'No machine-readable URLs were found in the draft, its resolution section, references, or source claims. Add explicit source URLs to the resolution rules before finalizing.',
  'gate.sourceErrorText': 'Accessibility check failed: {error}. This does not block Finalize, but you should verify the sources manually.',
  'gate.sourceUnreachableHeading': 'Unreachable ({n}):',
  'gate.sourceReachableHeading': 'Reachable ({n}):',
  'gate.sourceWarningAll': 'None of the cited data sources resolved from the browser. The oracle cannot read a source it cannot reach — revise the draft with working URLs before finalizing, or acknowledge to finalize anyway.',
  'gate.sourceWarningSome': 'Some cited data sources did not resolve from the browser. Revise the draft with working URLs, or acknowledge to finalize anyway.',
  'gate.sourceAck': 'Acknowledge unreachable sources & unlock Finalize',
  'gate.unknownError': 'unknown error',

  // Origin labels
  'origin.sourceClaim': 'source claim',
  'origin.resolutionSection': 'resolution section',
  'origin.references': 'references block',
  'origin.draftBody': 'draft body',

  // Claim categories
  'claimCategory.resolutionSource': 'Resolution source',
  'claimCategory.resolutionRule': 'Resolution rule',
  'claimCategory.outcomeCoverage': 'Outcome coverage',
  'claimCategory.edgeCase': 'Edge case',
  'claimCategory.timing': 'Timing / deadline',
  'claimCategory.oracle': 'Oracle / data source',
  'claimCategory.claim': 'Claim',

  // Routing reasons
  'routingReason.verificationHard': 'Failed a verification check',
  'routingReason.verificationSoft': 'Flagged as a potential issue during verification',
  'routingReason.draftContradicts': 'The draft contradicts this claim',
  'routingReason.notCovered': 'Not clearly addressed in the draft',
  'routingReason.urlUnreachable': 'A linked source could not be reached',
  'routingReason.globalBlocker': 'A reviewer flagged a market-wide issue',
  'routingReason.blockerCount': 'Reviewers raised {n} blocking concern',
  'routingReason.blockerCountPlural': 'Reviewers raised {n} blocking concerns',
  'routingReason.majorCount': 'Reviewers raised {n} major concern',
  'routingReason.majorCountPlural': 'Reviewers raised {n} major concerns',
  'routingReason.runBlocker': 'a blocker applies to the whole run',

  // Feedback
  'feedback.heading': 'Your Feedback',
  'feedback.hint': 'Optional — included when you click Update Draft',
  'feedback.placeholder': 'Add your own critiques or additional feedback...',

  // Reviews
  'reviews.deliberated': 'Deliberated Review',
  'reviews.councilDeliberation': 'Council Deliberation',
  'reviews.reviewerN': 'Reviewer {n}',
  'reviews.agentReview': 'Agent Review',

  // Final
  'final.heading': 'Final Market Details',
  'final.description': 'Description',
  'final.outcomes': 'Outcomes ({n})',
  'final.winsIf': 'Wins if:',
  'final.resolvedBy': 'Resolved by:',
  'final.resolutionRules': 'Resolution Rules',
  'final.edgeCases': 'Edge Cases',
  'final.earlyResolutionRisk': 'Early Resolution Risk',
  'final.marketPeriod': 'Market Period',
  'final.rigorHuman': 'Produced in Human mode (prompts softened, text polished).',
  'final.rigorMachine': 'Produced in Machine mode (full rigor).',
  'final.createAnother': 'Create Another Market',

  // Run trace
  'trace.heading': 'Run trace',
  'trace.summaryDrafts': '{n} draft',
  'trace.summaryDraftsPlural': '{n} drafts',
  'trace.summaryClaims': '{n} claim',
  'trace.summaryClaimsPlural': '{n} claims',
  'trace.summaryTokens': '{n} tok',
  'trace.exportRun': 'Export run as JSON',
  'trace.importRun': 'Import run',
  'trace.empty': 'No run yet. Generate or submit a draft to start a run.',
  'trace.run': 'Run {id}',
  'trace.started': 'Started',
  'trace.question': 'Question',
  'trace.draftsHeading': 'Drafts ({n})',
  'trace.noDrafts': 'No drafts yet.',
  'trace.claimsHeading': 'Claims ({n})',
  'trace.noClaims': 'No claims extracted yet.',
  'trace.aggregationHeading': 'Aggregation ({protocol})',
  'trace.judge': 'Judge: {rationale}',
  'trace.noChecklist': 'No checklist items recorded.',
  'trace.criticismsHeading': 'Criticisms ({n})',
  'trace.verificationHeading': 'Verification ({n})',
  'trace.verifyPass': '{n} pass',
  'trace.verifySoft': '{n} soft',
  'trace.verifyHard': '{n} hard',
  'trace.urlMissing': 'url missing',
  'trace.routingHeading': 'Routing',
  'trace.routingBlocking': '{n} blocking',
  'trace.routingTargeted': '{n} targeted',
  'trace.routingOk': '{n} ok',
  'trace.evidenceHeading': 'Evidence ({n})',
  'trace.evidenceResolved': '{n} resolved',
  'trace.evidenceFailed': ', {n} failed',
  'trace.cost': 'Cost',
  'trace.tokensIn': 'Tokens in',
  'trace.tokensOut': 'Tokens out',
  'trace.wallClock': 'Wall clock',
  'trace.tokens': '{n} tok',
  'trace.logHeading': 'Log ({n})',

  // Loading state — phase config
  'loading.draftLabel': 'Drafting market proposal',
  'loading.draftMsg1': 'Analyzing your question...',
  'loading.draftMsg2': 'Researching resolution criteria...',
  'loading.draftMsg3': 'Structuring market parameters...',
  'loading.draftMsg4': 'Composing draft...',
  'loading.reviewLabel': 'Reviewing draft',
  'loading.reviewMsg1': 'Reading the draft carefully...',
  'loading.reviewMsg2': 'Identifying ambiguities...',
  'loading.reviewMsg3': 'Checking resolution criteria...',
  'loading.reviewMsg4': 'Compiling critique...',
  'loading.updateLabel': 'Updating draft with feedback',
  'loading.updateMsg1': 'Incorporating review feedback...',
  'loading.updateMsg2': 'Refining resolution criteria...',
  'loading.updateMsg3': 'Improving clarity...',
  'loading.updateMsg4': 'Polishing the draft...',
  'loading.acceptLabel': 'Finalizing market',
  'loading.acceptMsg1': 'Structuring market data...',
  'loading.acceptMsg2': 'Formatting resolution rules...',
  'loading.acceptMsg3': 'Generating final JSON...',
  'loading.acceptMsg4': 'Almost there...',
  'loading.earlyResLabel': 'Analyzing early resolution risk',
  'loading.earlyResMsg1': 'Reviewing outcomes and resolution rules...',
  'loading.earlyResMsg2': 'Evaluating scenarios for early certainty...',
  'loading.earlyResMsg3': 'Assessing risk level...',
  'loading.earlyResMsg4': 'Compiling analysis...',
  'loading.ideateLabel': 'Brainstorming market ideas',
  'loading.ideateMsg1': 'Researching the topic area...',
  'loading.ideateMsg2': 'Scanning for catalysts and trends...',
  'loading.ideateMsg3': 'Generating candidate questions...',
  'loading.ideateMsg4': 'Curating the most interesting ideas...',
  'loading.rigorHuman': 'Human',
  'loading.rigorMachine': 'Machine',

  // Validation (codes returned by util/draftInput.js)
  'validation.question.required': 'Market question is required.',
  'validation.startDate.required': 'Start date and time is required.',
  'validation.startDate.invalid': 'Enter a valid UTC start date and time.',
  'validation.startDate.past': 'Start date and time must be in the future.',
  'validation.endDate.required': 'End date and time is required.',
  'validation.endDate.invalid': 'Enter a valid UTC end date and time.',
  'validation.endDate.beforeStart': 'End date and time must be later than Start.',

  // Run-trace log fallbacks. Most log content is dynamic (raw model errors,
  // counts, stage diagnostics) and stays in its source language; these are
  // the static fallbacks the App emits when an underlying error has no
  // message of its own.
  'log.draftFailed': 'Draft failed',
  'log.reviewFailed': 'Review failed',
  'log.updateFailed': 'Update failed',
  'log.finalizeFailed': 'Finalize failed',
  'log.earlyResolutionFailed': 'Early resolution check failed',
  'log.sourceAccessibilityFailed': 'Source accessibility check failed',
  'log.claimExtractionCrashed': 'Background claim extraction crashed: {message}',

  // Errors
  'error.copy': 'Failed to copy to clipboard',
  'error.draft': 'Failed to generate draft',
  'error.review': 'Failed to generate review',
  'error.update': 'Failed to update draft',
  'error.allReviewersFailed': 'All reviewers failed. Please try again.',
  'error.earlyResolution': 'Failed to analyze early resolution risk',
  'error.sourceAccessibility': 'Failed to check source accessibility',
  'error.finalize': 'Failed to finalize market',
  'error.ideate': 'Failed to generate market ideas',
  'error.exportRun': 'Failed to export run: {message}',
  'error.importInvalid': 'Import failed: file is not a valid Run JSON.',
  'error.importGeneric': 'Import failed: {message}',
  'error.readImport': 'Failed to read import file.',
};

const ZH = {
  // Header / output style toggle
  'header.outputStyle': '输出风格',
  'header.machineMode': '机器模式',
  'header.humanMode': '人类模式',
  'header.machineModeTooltip': '面向智能体的长篇、严谨输出。',
  'header.humanModeTooltip': '简洁易读的输出。',
  'header.machineModeAria': '机器模式:面向智能体的长篇、严谨输出',
  'header.humanModeAria': '人类模式:简洁易读的输出',

  // Language toggle
  'language.toggleAria': '切换语言',
  'language.switchTo': '切换到{label}',

  // Ambient toggle
  'ambient.switchTo': '切换到{label}主题 [{shortcut}]',
  'ambient.switchToAria': '切换到{label}主题',
  'ambient.light': '浅色',
  'ambient.dark': '深色',

  // Steps
  'step.setup': '设置',
  'step.draftReview': '草稿与审阅',
  'step.finalize': '定稿',

  // Mode toggle
  'mode.ideating': '构思',
  'mode.draftMarket': '起草市场',

  // Draft form
  'form.question': '42.space 市场问题',
  'form.questionPlaceholder': '例如:2026 年告示牌百强年终榜冠军是哪位艺人?',
  'form.startDate': '开始日期与时间',
  'form.endDate': '结束日期与时间',
  'form.utc': '(UTC)',
  'form.optional': '(可选)',
  'form.references': '参考资料',
  'form.referencesPlaceholder': '粘贴 AI 可参考的链接或备注,每行一条……',
  'form.numberOfOutcomes': '结果数量',
  'form.numberOfOutcomesPlaceholder': '留空由起草者决定',
  'form.draftingModel': '起草模型',
  'form.drafting': '起草中……',
  'form.draftMarket': '起草市场',

  // Review form
  'form.pasteExistingDraft': '粘贴现有草稿',
  'form.pasteExistingDraftPlaceholder': '在此粘贴你现有的市场草稿……',
  'form.submitForReview': '提交审阅',

  // Ideating form
  'form.vagueDirection': '模糊方向',
  'form.vagueDirectionPlaceholder': "描述一个大致的兴趣方向 — 例如:'2026 电竞总决赛季'、'即将到来的颁奖季'、'Meme 币叙事'。模型将围绕 42.space 形态构思多结果市场创意。",
  'form.ideationModel': '构思模型',
  'form.ideating': '构思中……',
  'form.generateIdeas': '生成创意',

  // Ideas
  'ideas.heading': '市场创意',
  'ideas.refresh': '刷新',
  'ideas.refreshTitle': '生成新一批 3 个创意',
  'ideas.refreshAria': '刷新创意',
  'ideas.useTitle': '在「起草市场」中使用此创意',
  'ideas.useAria': '在「起草市场」中使用创意 {n}',
  'ideas.fallbackTitle': '创意 {n}',

  // Draft output
  'draft.heading': '草稿',
  'draft.versionTitle': '第 {current} 版,共 {total} 版',
  'draft.updated': '已更新 ',
  'draft.versionHistoryAria': '草稿版本历史',
  'draft.previousVersion': '上一版',
  'draft.nextVersion': '下一版',
  'draft.viewingEarlier': '正在查看较早版本(第 {current} 版,共 {total} 版)',
  'draft.jumpToLatest': '跳到最新',

  // Generic
  'common.copy': '复制',
  'common.copied': '已复制!',
  'common.copyAll': '全部复制',
  'common.dismiss': '关闭',
  'common.justNow': '刚刚',
  'common.secondsAgo': '{n} 秒前',
  'common.minutesAgo': '{n} 分钟前',
  'common.hoursAgo': '{n} 小时前',
  'common.modelAria': '模型:{name}',
  'common.none': '(无)',

  // Panel placeholders
  'placeholder.draftReview': '完成设置并起草一个市场以继续',
  'placeholder.finalize': '起草、审阅并更新市场后即可定稿',

  // Action toolbar
  'toolbar.reviewCouncil': '审阅小组',
  'toolbar.removeReviewer': '移除审阅者',
  'toolbar.addReviewer': '+ 添加审阅者',
  'toolbar.councilHintMulti': '多位审阅者将进行讨论以产出更有力的批评',
  'toolbar.councilHintSingle': '讨论需至少两位审阅者;请再添加一个模型用于对照',
  'toolbar.aggregation': '聚合方式',
  'toolbar.aggMajority': '按各项规则进行多数投票;平局升级处理。',
  'toolbar.aggUnanimity': '所有审阅者必须一致;一个反对即视为不通过。',
  'toolbar.aggJudge': '由裁判模型阅读所有投票后做出最终裁决。',
  'toolbar.councilChanged': '小组已更改;在更新前请重新运行审阅。',
  'toolbar.review': '审阅',
  'toolbar.reviewAndDeliberate': '审阅并讨论',
  'toolbar.rerun': '重新运行{action}',
  'toolbar.reviewing': '审阅中……',
  'toolbar.deliberating': '讨论中……',
  'toolbar.reviewAlreadyCurrent': '此审阅已反映当前选定的小组。请更新草稿或更改小组以再次审阅。',
  'toolbar.updateDraft': '更新草稿',
  'toolbar.updating': '更新中……',
  'toolbar.acceptFinalize': '接受并定稿',
  'toolbar.finalizing': '定稿中……',
  'toolbar.acceptTitleConfigChanged': '请在定稿前用所选小组重新审阅并更新草稿。',
  'toolbar.acceptTitleNeedsRiskAck': '请先确认下方的「高」提前结算风险后再定稿。',
  'toolbar.acceptTitleNeedsRoutingAck': '请在定稿前解决或确认严谨流水线标记出的阻断性陈述。',
  'toolbar.acceptTitleNeedsSourceAck': '决议规则中有一个或多个数据源无法访问。请修复数据源并重新运行更新,或确认后强制定稿。',

  // Risk gates — Early Resolution
  'gate.earlyLabel': '提前结算风险',
  'gate.checking': '检查中……',
  'gate.unknown': '未知',
  'gate.high': '高',
  'gate.medium': '中',
  'gate.low': '低',
  'gate.earlyWarning': '此市场可能在结束日期之前就已结算。请确认风险以解锁「定稿」,或修改草稿(例如:加入明确的提前结算条款、缩短窗口、或收紧结果集)。',
  'gate.earlyAck': '确认「高」风险并解锁「定稿」',

  // Risk gates — Rigor Routing
  'gate.routingLabel': '严谨路由',
  'gate.routingBlocked': '已阻断',
  'gate.routingNeedsUpdate': '需要更新',
  'gate.routingHint': '这些检查会验证草稿中的陈述 — 决议来源、规则、边缘情况 — 是否一致且有充分依据。',
  'gate.routingMustFix': '定稿前必须修复({n}):',
  'gate.routingWorthReviewing': '值得复查({n}):',
  'gate.routingAffectingOne': '影响所有 {n} 个被标记的陈述:',
  'gate.routingAffectingMany': '影响所有 {n} 个被标记的陈述:',
  'gate.routingClaimUnavailable': '(陈述文本不可用)',
  'gate.routingWhyBlocked': '为何被阻断:',
  'gate.routingWarning': '草稿被阻断,因为有一个或多个陈述存在严重问题。请重新运行「审阅 → 更新」修复它们,或确认后强制定稿。',
  'gate.routingAck': '确认阻断性陈述并解锁「定稿」',

  // Risk gates — Source Accessibility
  'gate.sourceLabel': '数据源可访问性',
  'gate.sourceReachable': '可访问',
  'gate.sourcePartial': '部分可访问',
  'gate.sourceAllUnreachable': '全部无法访问',
  'gate.sourceNoSources': '无来源',
  'gate.sourceError': '错误',
  'gate.sourceUnknown': '未知',
  'gate.sourceHint': '探测决议规则中的每个数据源,以确认结算时神谕能够实际读取它。无法访问的数据源会让市场存在无法结算的风险 — 请在定稿前修复。',
  'gate.sourceNoSourcesText': '在草稿、决议章节、参考资料或来源陈述中均未发现机器可读的 URL。请在定稿前在决议规则中加入明确的来源 URL。',
  'gate.sourceErrorText': '可访问性检查失败:{error}。这不会阻止「定稿」,但你应当手动核实数据源。',
  'gate.sourceUnreachableHeading': '不可访问({n}):',
  'gate.sourceReachableHeading': '可访问({n}):',
  'gate.sourceWarningAll': '所有引用的数据源都无法在浏览器中解析。神谕无法读取它无法访问的来源 — 请在定稿前用可用的 URL 修改草稿,或确认后强制定稿。',
  'gate.sourceWarningSome': '部分引用的数据源无法在浏览器中解析。请用可用的 URL 修改草稿,或确认后强制定稿。',
  'gate.sourceAck': '确认无法访问的数据源并解锁「定稿」',
  'gate.unknownError': '未知错误',

  // Origin labels
  'origin.sourceClaim': '来源陈述',
  'origin.resolutionSection': '决议章节',
  'origin.references': '参考资料',
  'origin.draftBody': '草稿正文',

  // Claim categories
  'claimCategory.resolutionSource': '决议来源',
  'claimCategory.resolutionRule': '决议规则',
  'claimCategory.outcomeCoverage': '结果覆盖',
  'claimCategory.edgeCase': '边缘情况',
  'claimCategory.timing': '时间 / 截止',
  'claimCategory.oracle': '神谕 / 数据源',
  'claimCategory.claim': '陈述',

  // Routing reasons
  'routingReason.verificationHard': '未通过验证检查',
  'routingReason.verificationSoft': '在验证中被标记为潜在问题',
  'routingReason.draftContradicts': '草稿与此陈述相互矛盾',
  'routingReason.notCovered': '草稿中未明确处理',
  'routingReason.urlUnreachable': '链接的来源无法访问',
  'routingReason.globalBlocker': '审阅者标记了一个市场范围的问题',
  'routingReason.blockerCount': '审阅者提出了 {n} 项阻断性顾虑',
  'routingReason.blockerCountPlural': '审阅者提出了 {n} 项阻断性顾虑',
  'routingReason.majorCount': '审阅者提出了 {n} 项重大顾虑',
  'routingReason.majorCountPlural': '审阅者提出了 {n} 项重大顾虑',
  'routingReason.runBlocker': '一个阻断项适用于整次运行',

  // Feedback
  'feedback.heading': '你的反馈',
  'feedback.hint': '可选 — 在你点击「更新草稿」时一并加入',
  'feedback.placeholder': '添加你自己的批评或额外反馈……',

  // Reviews
  'reviews.deliberated': '已讨论的审阅',
  'reviews.councilDeliberation': '小组讨论',
  'reviews.reviewerN': '审阅者 {n}',
  'reviews.agentReview': '智能体审阅',

  // Final
  'final.heading': '最终市场详情',
  'final.description': '描述',
  'final.outcomes': '结果({n})',
  'final.winsIf': '获胜条件:',
  'final.resolvedBy': '决议依据:',
  'final.resolutionRules': '决议规则',
  'final.edgeCases': '边缘情况',
  'final.earlyResolutionRisk': '提前结算风险',
  'final.marketPeriod': '市场周期',
  'final.rigorHuman': '在「人类模式」下产出(提示已柔化、文字已润色)。',
  'final.rigorMachine': '在「机器模式」下产出(完整严谨)。',
  'final.createAnother': '创建另一个市场',

  // Run trace
  'trace.heading': '运行轨迹',
  'trace.summaryDrafts': '{n} 份草稿',
  'trace.summaryDraftsPlural': '{n} 份草稿',
  'trace.summaryClaims': '{n} 条陈述',
  'trace.summaryClaimsPlural': '{n} 条陈述',
  'trace.summaryTokens': '{n} 词元',
  'trace.exportRun': '将运行导出为 JSON',
  'trace.importRun': '导入运行',
  'trace.empty': '暂无运行。生成或提交一份草稿以开始一次运行。',
  'trace.run': '运行 {id}',
  'trace.started': '开始',
  'trace.question': '问题',
  'trace.draftsHeading': '草稿({n})',
  'trace.noDrafts': '暂无草稿。',
  'trace.claimsHeading': '陈述({n})',
  'trace.noClaims': '尚未提取出陈述。',
  'trace.aggregationHeading': '聚合({protocol})',
  'trace.judge': '裁判:{rationale}',
  'trace.noChecklist': '未记录任何清单项。',
  'trace.criticismsHeading': '批评({n})',
  'trace.verificationHeading': '验证({n})',
  'trace.verifyPass': '{n} 通过',
  'trace.verifySoft': '{n} 软失败',
  'trace.verifyHard': '{n} 硬失败',
  'trace.urlMissing': 'URL 缺失',
  'trace.routingHeading': '路由',
  'trace.routingBlocking': '{n} 阻断',
  'trace.routingTargeted': '{n} 定向复查',
  'trace.routingOk': '{n} 正常',
  'trace.evidenceHeading': '证据({n})',
  'trace.evidenceResolved': '{n} 已解析',
  'trace.evidenceFailed': ',{n} 失败',
  'trace.cost': '成本',
  'trace.tokensIn': '输入词元',
  'trace.tokensOut': '输出词元',
  'trace.wallClock': '挂钟时间',
  'trace.tokens': '{n} 词元',
  'trace.logHeading': '日志({n})',

  // Loading state — phase config
  'loading.draftLabel': '正在起草市场提案',
  'loading.draftMsg1': '正在分析你的问题……',
  'loading.draftMsg2': '正在研究决议标准……',
  'loading.draftMsg3': '正在构建市场参数……',
  'loading.draftMsg4': '正在撰写草稿……',
  'loading.reviewLabel': '正在审阅草稿',
  'loading.reviewMsg1': '正在仔细阅读草稿……',
  'loading.reviewMsg2': '正在识别歧义……',
  'loading.reviewMsg3': '正在检查决议标准……',
  'loading.reviewMsg4': '正在汇编批评……',
  'loading.updateLabel': '正在根据反馈更新草稿',
  'loading.updateMsg1': '正在吸收审阅反馈……',
  'loading.updateMsg2': '正在精炼决议标准……',
  'loading.updateMsg3': '正在提升清晰度……',
  'loading.updateMsg4': '正在润色草稿……',
  'loading.acceptLabel': '正在定稿市场',
  'loading.acceptMsg1': '正在结构化市场数据……',
  'loading.acceptMsg2': '正在格式化决议规则……',
  'loading.acceptMsg3': '正在生成最终 JSON……',
  'loading.acceptMsg4': '马上就好……',
  'loading.earlyResLabel': '正在分析提前结算风险',
  'loading.earlyResMsg1': '正在审阅结果与决议规则……',
  'loading.earlyResMsg2': '正在评估提前确定的情形……',
  'loading.earlyResMsg3': '正在评估风险等级……',
  'loading.earlyResMsg4': '正在汇编分析……',
  'loading.ideateLabel': '正在头脑风暴市场创意',
  'loading.ideateMsg1': '正在研究主题领域……',
  'loading.ideateMsg2': '正在扫描催化剂与趋势……',
  'loading.ideateMsg3': '正在生成候选问题……',
  'loading.ideateMsg4': '正在精选最有意思的创意……',
  // Keep these as English so the existing component test (which renders
  // without a provider) continues to find them.
  'loading.rigorHuman': 'Human',
  'loading.rigorMachine': 'Machine',

  // Validation (codes returned by util/draftInput.js)
  'validation.question.required': '请填写市场问题。',
  'validation.startDate.required': '请填写开始日期与时间。',
  'validation.startDate.invalid': '请输入有效的 UTC 开始日期与时间。',
  'validation.startDate.past': '开始日期与时间必须在未来。',
  'validation.endDate.required': '请填写结束日期与时间。',
  'validation.endDate.invalid': '请输入有效的 UTC 结束日期与时间。',
  'validation.endDate.beforeStart': '结束日期与时间必须晚于开始时间。',

  // Run-trace log fallbacks. Most log content is dynamic (raw model errors,
  // counts, stage diagnostics) and stays in its source language; these are
  // the static fallbacks the App emits when an underlying error has no
  // message of its own.
  'log.draftFailed': '起草失败',
  'log.reviewFailed': '审阅失败',
  'log.updateFailed': '更新失败',
  'log.finalizeFailed': '定稿失败',
  'log.earlyResolutionFailed': '提前结算检查失败',
  'log.sourceAccessibilityFailed': '数据源可访问性检查失败',
  'log.claimExtractionCrashed': '后台陈述提取崩溃:{message}',

  // Errors
  'error.copy': '复制到剪贴板失败',
  'error.draft': '生成草稿失败',
  'error.review': '生成审阅失败',
  'error.update': '更新草稿失败',
  'error.allReviewersFailed': '所有审阅者均失败,请重试。',
  'error.earlyResolution': '分析提前结算风险失败',
  'error.sourceAccessibility': '检查数据源可访问性失败',
  'error.finalize': '定稿市场失败',
  'error.ideate': '生成市场创意失败',
  'error.exportRun': '导出运行失败:{message}',
  'error.importInvalid': '导入失败:文件不是有效的运行 JSON。',
  'error.importGeneric': '导入失败:{message}',
  'error.readImport': '读取导入文件失败。',
};

export const TRANSLATIONS = { en: EN, zh: ZH };

function applyParams(str, params) {
  if (!params) return str;
  let out = str;
  for (const key of Object.keys(params)) {
    out = out.split(`{${key}}`).join(String(params[key]));
  }
  return out;
}

export function translate(lang, key, params) {
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
  const value = dict[key] != null ? dict[key] : (TRANSLATIONS.en[key] != null ? TRANSLATIONS.en[key] : key);
  return applyParams(value, params);
}
