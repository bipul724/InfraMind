import fs from 'fs-extra';
import path from 'path';
import { redactSecrets } from '../utils/repository.js';
import { AiError, generateText } from '../ai/index.js';
import { extractFileContent } from './files.js';
import { collectRepositoryEvidence, detectPythonFrameworks, readRepoJson } from './grounding.js';
import {
  buildGeneratorSystemPrompt,
  buildVerifierSystemPrompt,
  generatorUserPrompt,
  repairUserPrompt
} from './prompts.js';

// state.errors is sent to the browser, so it only ever holds fixed text: the AI layer's
// constant message, or "Internal error" (the real error is logged server-side, redacted)
function publicErrorMessage(agent, error) {
  if (error instanceof AiError) return error.message;
  console.error(`${agent} Agent internal error: ${redactSecrets(error)}`);
  return 'Internal error';
}

// Agent state interface
class AgentState {
  constructor() {
    this.repoName = ''; // owner/repo label; never a URL or a filesystem path
    this.repoPath = '';
    this.codebaseAnalysis = null;
    this.techStack = null;
    this.projectStructure = null;
    this.generatedFiles = {};
    this.currentStep = '';
    this.progress = 0;
    this.messages = [];
    this.errors = [];
    this.evidence = null; // manifests and evidence flags for the generator prompts; never saved or sent to the browser
    this.meta = {}; // { sessionId, userId }: passed to the AI call records only, never to a provider
  }
}

// Planner Agent - Decides what needs to be analyzed and built
const plannerAgent = async (state) => {
  console.log('🤔 Planner Agent: Planning project analysis...');
  
  state.currentStep = 'Planning project analysis';
  state.progress = 20;
  
  const plannerPrompt = `You are a DevOps Planning Agent. Your task is to analyze the repository structure and create a comprehensive plan.

Repository: ${state.repoName}

Based on typical project patterns, create a plan that includes:
1. File types to analyze for tech stack detection
2. Key configuration files to examine
3. Dependencies to check
4. Deployment strategy recommendations

Return a JSON plan with these categories.`;

  try {
    const response = await generateText({
      task: 'planner',
      system: plannerPrompt,
      prompt: `Plan the analysis for: ${state.repoName}`,
      meta: state.meta
    });
    
    state.messages.push({
      agent: 'planner',
      message: 'Created comprehensive analysis plan',
      timestamp: new Date().toISOString()
    });
    
    // Parse the response to extract planning information
    const planContent = response.text;
    state.analysisplan = planContent;
    
    return state;
  } catch (error) {
    state.errors.push(`Planner Agent Error: ${publicErrorMessage('Planner', error)}`);
    return state;
  }
};

// Analyzer Agent - Analyzes the codebase structure and determines tech stack
const analyzerAgent = async (state) => {
  console.log('🔍 Analyzer Agent: Analyzing codebase...');
  
  state.currentStep = 'Analyzing codebase structure';
  state.progress = 50;
  
  try {
    // Read project structure
    const projectFiles = await scanProjectStructure(state.repoPath);
    state.projectStructure = projectFiles;
    
    // Analyze tech stack
    const techStackAnalysis = await analyzeTechStack(state.repoPath, projectFiles);
    state.techStack = techStackAnalysis;
    
    // Detailed codebase analysis
    const detailedAnalysis = await performDetailedAnalysis(state.repoPath, projectFiles);
    state.codebaseAnalysis = detailedAnalysis;

    // Manifests, existing configuration and evidence flags, for the generator prompts only
    state.evidence = await collectRepositoryEvidence(state.repoPath, projectFiles);
    
    state.messages.push({
      agent: 'analyzer',
      message: `Detected tech stack: ${techStackAnalysis.primary}`,
      timestamp: new Date().toISOString()
    });
    
    return state;
  } catch (error) {
    state.errors.push(`Analyzer Agent Error: ${publicErrorMessage('Analyzer', error)}`);
    return state;
  }
};

// Generator Agent - Generates CI/CD files based on analysis.
// The three files are independent: each success sets its own key, each failure adds one
// "Generator Agent Error: <label>: ..." entry, and the other files are kept.
// Each reply is reduced to one raw file and validated (agents/files.js). An invalid reply
// gets one repair call; if that fails too, the file is not saved. AI-layer errors are not
// retried here: the AI layer already retries and falls back.
const GENERATED_FILES = [
  { key: 'dockerfile', label: 'Dockerfile' },
  { key: 'githubActions', label: 'GitHub Actions workflow' },
  { key: 'envExample', label: '.env.example' }
];
const VALIDATION_FAILED = 'the AI output did not pass validation';

// Kind and error list only: never file content
const logValidationFailure = (kind, attempt, errors) => {
  console.warn(`Generator validation failed: kind=${kind} attempt=${attempt} errors=${errors.join('; ')}`);
};

async function generateOneFile(state, file, system) {
  const ask = (prompt) => generateText({ task: 'generator', system, prompt, meta: state.meta });

  const first = extractFileContent(file.key, (await ask(generatorUserPrompt(file.key))).text);
  if (first.ok) return first.content;
  logValidationFailure(file.key, 1, first.errors);

  const repaired = extractFileContent(file.key, (await ask(repairUserPrompt(file.key, first.errors))).text);
  if (repaired.ok) return repaired.content;
  logValidationFailure(file.key, 2, repaired.errors);
  return null;
}

const generatorAgent = async (state) => {
  console.log('⚡ Generator Agent: Generating CI/CD files...');
  
  state.currentStep = 'Generating CI/CD configurations';
  state.progress = 80;

  const context = {
    repoName: state.repoName,
    techStack: state.techStack,
    projectFiles: state.projectStructure || {},
    evidence: state.evidence || {
      manifests: [], manifestsOmitted: [], existingConfig: { names: [], excerpts: [], omitted: [] },
      entryPoints: [], testEvidence: [], linterEvidence: [], pythonDependencies: []
    }
  };

  state.generatedFiles = {};
  for (const file of GENERATED_FILES) {
    try {
      const { system } = buildGeneratorSystemPrompt(file.key, context);
      const content = await generateOneFile(state, file, system);
      if (content === null) {
        state.errors.push(`Generator Agent Error: ${file.label}: ${VALIDATION_FAILED}`);
      } else {
        state.generatedFiles[file.key] = content;
      }
    } catch (error) {
      state.errors.push(`Generator Agent Error: ${file.label}: ${publicErrorMessage('Generator', error)}`);
    }
  }

  const generated = Object.keys(state.generatedFiles).length;
  if (generated > 0) {
    state.messages.push({
      agent: 'generator',
      message: `Generated ${generated} of ${GENERATED_FILES.length} files`,
      timestamp: new Date().toISOString()
    });
  }

  return state;
};

// Verifier Agent - Asks the AI to review the generated files. With no files there is
// nothing to review: no AI call, no message, verificationResults stays unset.
const verifierAgent = async (state) => {
  console.log('✅ Verifier Agent: Validating generated files...');
  
  state.currentStep = 'Validating generated configurations';
  state.progress = 95;

  const present = GENERATED_FILES.filter((file) => typeof state.generatedFiles[file.key] === 'string');
  if (present.length === 0) {
    state.currentStep = 'Review skipped: no files were generated';
    state.progress = 100;
    return state;
  }
  
  // Each saved file up to 4,000 characters, within the 24,000-character prompt cap
  const verifierPrompt = buildVerifierSystemPrompt(
    present.map((file) => ({ label: file.label, content: state.generatedFiles[file.key] }))
  );

  try {
    const response = await generateText({
      task: 'verifier',
      system: verifierPrompt,
      prompt: 'Verify and validate all generated files',
      meta: state.meta
    });
    
    state.verificationResults = response.text;
    state.currentStep = 'Complete';
    state.progress = 100;
    
    // A statement of what happened, not a verdict: the review itself is the text in
    // verificationResults
    state.messages.push({
      agent: 'verifier',
      message: 'Review complete: see the review text',
      timestamp: new Date().toISOString()
    });
    
    return state;
  } catch (error) {
    state.errors.push(`Verifier Agent Error: ${publicErrorMessage('Verifier', error)}`);
    return state;
  }
};

// Helper function to scan project structure
async function scanProjectStructure(repoPath) {
  const structure = {};
  
  const scanDirectory = async (dirPath, relativePath = '') => {
    try {
      const items = await fs.readdir(dirPath);
      
      for (const item of items) {
        // Skip common directories that we don't need to analyze
        if (['.git', 'node_modules', '.next', 'dist', 'build', '__pycache__'].includes(item)) {
          continue;
        }
        
        const fullPath = path.join(dirPath, item);
        const itemRelativePath = path.join(relativePath, item);
        // lstat: cloned repositories are untrusted, so symlinks are never followed
        const stats = await fs.lstat(fullPath);
        
        if (stats.isSymbolicLink()) {
          continue;
        }
        if (stats.isDirectory()) {
          structure[itemRelativePath] = 'directory';
          await scanDirectory(fullPath, itemRelativePath);
        } else if (stats.isFile()) {
          structure[itemRelativePath] = 'file';
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error.message);
    }
  };
  
  await scanDirectory(repoPath);
  return structure;
}

// Top-level Compose files (Compose's own default names)
const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
const KUBERNETES_DIRECTORIES = new Set(['k8s', 'kubernetes']);
const KUBERNETES_FILES = new Set(['kustomization.yaml', 'kustomization.yml', 'Chart.yaml']);

// Kubernetes-specific evidence only, from names (no file is read): a directory named
// k8s or kubernetes at any depth (which also covers every .yaml/.yml file under one),
// or a kustomization.yaml/.yml or Helm Chart.yaml file at any depth. Other YAML files
// (lock files, CI and tool configs) do not count.
function hasKubernetesEvidence(projectFiles) {
  return Object.entries(projectFiles).some(([relativePath, kind]) => {
    const segments = relativePath.split(path.sep);
    const name = segments[segments.length - 1];
    if (kind === 'directory') return KUBERNETES_DIRECTORIES.has(name);
    return KUBERNETES_FILES.has(name) || segments.slice(0, -1).some((segment) => KUBERNETES_DIRECTORIES.has(segment));
  });
}

// Helper function to analyze tech stack
async function analyzeTechStack(repoPath, projectFiles) {
  const techStack = {
    primary: 'unknown',
    secondary: [],
    frameworks: [],
    databases: [],
    tools: []
  };
  
  const fileNames = Object.keys(projectFiles);
  
  // Check for common tech stack indicators
  if (fileNames.includes('package.json')) {
    techStack.primary = 'node';
    try {
      const packageJson = await readRepoJson(repoPath, 'package.json');
      if (packageJson.dependencies) {
        if (packageJson.dependencies.react) techStack.frameworks.push('react');
        if (packageJson.dependencies.next) techStack.frameworks.push('nextjs');
        if (packageJson.dependencies.vue) techStack.frameworks.push('vue');
        if (packageJson.dependencies.express) techStack.frameworks.push('express');
        if (packageJson.dependencies.mongoose) techStack.databases.push('mongodb');
        if (packageJson.dependencies.pg) techStack.databases.push('postgresql');
      }
    } catch (error) {
      console.error('Error reading package.json:', error.message);
    }
  } else if (fileNames.includes('requirements.txt') || fileNames.includes('pyproject.toml')) {
    techStack.primary = 'python';
    // From the dependency names in requirements*.txt, pyproject.toml and Pipfile, not from
    // file paths; manage.py still means django
    const frameworks = await detectPythonFrameworks(repoPath, projectFiles);
    if (fileNames.includes('manage.py') && !frameworks.includes('django')) frameworks.unshift('django');
    techStack.frameworks.push(...frameworks);
  } else if (fileNames.includes('go.mod')) {
    techStack.primary = 'go';
  } else if (fileNames.includes('Cargo.toml')) {
    techStack.primary = 'rust';
  } else if (fileNames.includes('pom.xml') || fileNames.includes('build.gradle')) {
    techStack.primary = 'java';
    if (fileNames.some(f => f.includes('spring'))) techStack.frameworks.push('spring');
  }
  
  // Check for containerization
  if (fileNames.includes('Dockerfile')) techStack.tools.push('docker');
  if (COMPOSE_FILES.some((name) => fileNames.includes(name))) techStack.tools.push('docker-compose');
  if (hasKubernetesEvidence(projectFiles)) techStack.tools.push('kubernetes');
  
  return techStack;
}

// Helper function for detailed analysis
async function performDetailedAnalysis(repoPath, projectFiles) {
  const analysis = {
    entryPoints: [],
    configFiles: [],
    buildCommands: [],
    testCommands: [],
    dependencies: {},
    recommendations: []
  };
  
  const fileNames = Object.keys(projectFiles);
  
  // Find entry points
  if (fileNames.includes('package.json')) {
    try {
      const packageJson = await readRepoJson(repoPath, 'package.json');
      if (packageJson.main) analysis.entryPoints.push(packageJson.main);
      if (packageJson.scripts) {
        if (packageJson.scripts.start) analysis.buildCommands.push('npm start');
        if (packageJson.scripts.build) analysis.buildCommands.push('npm run build');
        if (packageJson.scripts.test) analysis.testCommands.push('npm test');
      }
      analysis.dependencies = packageJson.dependencies || {};
    } catch (error) {
      console.error('Error analyzing package.json:', error.message);
    }
  }
  
  // Check for common config files
  const configFiles = ['tsconfig.json', 'webpack.config.js', 'vite.config.js', '.env.example', 'docker-compose.yml'];
  analysis.configFiles = fileNames.filter(f => configFiles.includes(f));
  
  // Generate recommendations
  if (!fileNames.includes('Dockerfile')) {
    analysis.recommendations.push('Add Dockerfile for containerization');
  }
  if (!fileNames.includes('.github/workflows')) {
    analysis.recommendations.push('Add GitHub Actions for CI/CD');
  }
  if (!fileNames.includes('.env.example')) {
    analysis.recommendations.push('Add .env.example for environment configuration');
  }
  
  return analysis;
}

// The four agents, in order, with the progress value each one reports when it finishes
// (B2.1: the same 20/50/80/95 the agents set on state.progress when they start)
const AGENT_SEQUENCE = [
  { agent: 'planner', run: (state) => plannerAgent(state), progress: 20 },
  { agent: 'analyzer', run: (state) => analyzerAgent(state), progress: 50 },
  { agent: 'generator', run: (state) => generatorAgent(state), progress: 80 },
  { agent: 'verifier', run: (state) => verifierAgent(state), progress: 95 }
];

// Simplified workflow implementation without langgraph. onAgentDone(report) is called
// after each agent with { agent, progress, currentStep, messages, errors }: copies of
// the state's arrays, never the state itself. A throwing callback stops the pipeline.
export function createAgentWorkflow() {
  return {
    async invoke(initialState, { onAgentDone = null } = {}) {
      let state = initialState;

      // Run agents in sequence
      for (const { agent, run, progress } of AGENT_SEQUENCE) {
        state = await run(state);
        if (onAgentDone) {
          await onAgentDone({
            agent,
            progress,
            currentStep: state.currentStep,
            messages: [...state.messages],
            errors: [...state.errors]
          });
        }
      }

      return state;
    }
  };
}

// Main function to run the agent pipeline
// repoName is the "owner/repo" label shown to the LLM; repoPath is only used locally;
// onAgentDone (optional) gets a report after each of the four agents (B2.1; it replaces
// the single callback that ran once after all four); meta ({ sessionId, userId })
// reaches only the AI call records
export async function runAgentPipeline(repoName, repoPath, onAgentDone = null, meta = {}) {
  console.log('🚀 Starting AI Agent Pipeline...');
  
  const workflow = createAgentWorkflow();
  const initialState = new AgentState();
  initialState.repoName = repoName;
  initialState.repoPath = repoPath;
  initialState.meta = { sessionId: meta?.sessionId ?? null, userId: meta?.userId ?? null };
  
  try {
    const result = await workflow.invoke(initialState, { onAgentDone });
    console.log('✅ AI Agent Pipeline completed successfully');
    return result;
  } catch (error) {
    console.error(`❌ AI Agent Pipeline failed: ${redactSecrets(error)}`);
    throw error;
  }
}

export { AgentState, AGENT_SEQUENCE, GENERATED_FILES, scanProjectStructure, analyzeTechStack };