/**
 * XenoOS Container Configuration Wizard
 * Step-by-step wizard for configuring dynamic container provisioning
 */

import React, { useState, useEffect } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  Server, 
  HardDrive, 
  Cpu, 
  Memory, 
  Users, 
  Code, 
  Shield, 
  Backup, 
  Headphones,
  Check,
  X,
  Calculator,
  Loader2
} from 'lucide-react';
import { ContainerConfig, LanguageConfig } from '../../../types/container';
import { calculateMonthlyPrice, formatPrice, validateContainerConfig } from '../../../utils/containerPricing';

interface ContainerConfigurationWizardProps {
  onComplete: (config: ContainerConfig) => void;
  onCancel: () => void;
  initialConfig?: Partial<ContainerConfig>;
  isVisible: boolean;
}

const ContainerConfigurationWizard: React.FC<ContainerConfigurationWizardProps> = ({
  onComplete,
  onCancel,
  initialConfig = {},
  isVisible
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [config, setConfig] = useState<ContainerConfig>({
    storage: initialConfig.storage || 10,
    cpu: initialConfig.cpu || 1,
    memory: initialConfig.memory || 2,
    languages: {
      nodejs: initialConfig.languages?.nodejs || false,
      python: initialConfig.languages?.python || false,
      go: initialConfig.languages?.go || false,
      rust: initialConfig.languages?.rust || false,
      java: initialConfig.languages?.java || false,
    },
    maxUsers: initialConfig.maxUsers || 1,
    realTimeSync: true,
    backups: initialConfig.backups || false,
    encryption: initialConfig.encryption || false,
    prioritySupport: initialConfig.prioritySupport || false,
    name: initialConfig.name || '',
    description: initialConfig.description || '',
  });

  const [monthlyPrice, setMonthlyPrice] = useState(0);
  const [validation, setValidation] = useState({ valid: true, errors: [] });
  const [stepValidationErrors, setStepValidationErrors] = useState<string[]>([]);

  // Update price whenever config changes
  useEffect(() => {
    const price = calculateMonthlyPrice(config);
    setMonthlyPrice(price);
    
    const validationResult = validateContainerConfig(config);
    setValidation(validationResult);
  }, [config]);

  // Clear validation errors when step changes
  useEffect(() => {
    setStepValidationErrors([]);
  }, [currentStep]);

  const steps = [
    {
      title: 'Resources',
      icon: <Server className="w-6 h-6" />,
      description: 'Configure CPU, memory, and storage',
      component: ResourcesStep,
    },
    {
      title: 'Languages',
      icon: <Code className="w-6 h-6" />,
      description: 'Select programming languages and tools',
      component: LanguagesStep,
    },
    {
      title: 'Collaboration',
      icon: <Users className="w-6 h-6" />,
      description: 'Configure user access and sharing',
      component: CollaborationStep,
    },
    {
      title: 'Features',
      icon: <Shield className="w-6 h-6" />,
      description: 'Add security and premium features',
      component: FeaturesStep,
    },
    {
      title: 'Review',
      icon: <Check className="w-6 h-6" />,
      description: 'Review configuration and pricing',
      component: ReviewStep,
    },
  ];

  const handleNext = () => {
    // Auto-select Node.js if no language is selected on Languages step
    if (currentStep === 1) { // Languages step
      const hasLanguageSelected = Object.values(config.languages).some(enabled => enabled);
      if (!hasLanguageSelected) {
        // Automatically select Node.js as default
        const updatedConfig = {
          ...config,
          languages: { ...config.languages, nodejs: true }
        };
        setConfig(updatedConfig);
      }
    }
    
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = async () => {
    if (!validation.valid) return;
    
    // Ensure at least one language is selected before submitting
    let finalConfig = { ...config };
    const hasLanguageSelected = Object.values(finalConfig.languages).some(enabled => enabled);
    if (!hasLanguageSelected) {
      finalConfig = {
        ...finalConfig,
        languages: { ...finalConfig.languages, nodejs: true }
      };
    }
    
    setIsCreating(true);
    try {
      await onComplete(finalConfig);
    } finally {
      setIsCreating(false);
    }
  };

  const updateConfig = (updates: Partial<ContainerConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  };

  if (!isVisible) return null;

  const CurrentStepComponent = steps[currentStep].component;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-4xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-white">Container Configuration</h2>
              <p className="text-gray-400 mt-1">
                Configure your development environment with exact pricing
              </p>
            </div>
            <button
              onClick={onCancel}
              className="text-gray-400 hover:text-white transition-colors"
              disabled={isCreating}
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Progress Bar */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">
                Step {currentStep + 1} of {steps.length}
              </span>
              <div className="flex items-center gap-2 text-green-400">
                <Calculator className="w-4 h-4" />
                <span className="font-mono font-bold">{formatPrice(monthlyPrice)}/month</span>
              </div>
            </div>
            <div className="flex gap-2">
              {steps.map((_, index) => (
                <div
                  key={index}
                  className={`flex-1 h-2 rounded-full ${
                    index <= currentStep ? 'bg-blue-500' : 'bg-gray-700'
                  }`}
                />
              ))}
            </div>
            <div className="flex justify-between mt-2">
              {steps.map((step, index) => (
                <div
                  key={index}
                  className={`flex items-center gap-2 text-xs ${
                    index <= currentStep ? 'text-blue-400' : 'text-gray-500'
                  }`}
                >
                  {step.icon}
                  <span>{step.title}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto" style={{ maxHeight: '60vh' }}>
          <div className="mb-4">
            <h3 className="text-xl font-semibold text-white mb-2">
              {steps[currentStep].title}
            </h3>
            <p className="text-gray-400">{steps[currentStep].description}</p>
          </div>

          {/* Helpful Info for Languages Step */}
          {currentStep === 1 && !Object.values(config.languages).some(enabled => enabled) && (
            <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                <p className="text-blue-400 text-sm font-medium">
                  💡 If you don't select a language, Node.js will be automatically selected when you proceed
                </p>
              </div>
            </div>
          )}

          <CurrentStepComponent
            config={config}
            updateConfig={updateConfig}
            monthlyPrice={monthlyPrice}
            validation={validation}
          />
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-700 bg-gray-800/50">
          <div className="flex items-center justify-between">
            <button
              onClick={handlePrevious}
              disabled={currentStep === 0}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>

            <div className="flex items-center gap-4">
              {/* Validation Errors */}
              {!validation.valid && validation.errors.length > 0 && (
                <div className="text-red-400 text-sm">
                  {validation.errors[0]}
                </div>
              )}

              {/* Price Display */}
              <div className="text-right">
                <div className="text-sm text-gray-400">Monthly Cost</div>
                <div className="text-xl font-bold text-green-400 font-mono">
                  {formatPrice(monthlyPrice)}
                </div>
              </div>
            </div>

            {currentStep === steps.length - 1 ? (
              <button
                onClick={handleComplete}
                disabled={!validation.valid || isCreating}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Create Container
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleNext}
                disabled={!validation.valid}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Resources Step Component
const ResourcesStep: React.FC<{
  config: ContainerConfig;
  updateConfig: (updates: Partial<ContainerConfig>) => void;
}> = ({ config, updateConfig }) => {
  return (
    <div className="space-y-6">
      {/* Container Name */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Container Name (Optional)
        </label>
        <input
          type="text"
          value={config.name || ''}
          onChange={(e) => updateConfig({ name: e.target.value })}
          placeholder="e.g., My Development Environment"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Storage */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <HardDrive className="w-5 h-5 text-gray-400" />
          <label className="text-sm font-medium text-gray-300">
            Storage: {config.storage}GB
          </label>
          <span className="text-xs text-gray-500 ml-auto">
            ${(config.storage * 0.10).toFixed(2)}/month
          </span>
        </div>
        <input
          type="range"
          min="10"
          max="2000"
          step="10"
          value={config.storage}
          onChange={(e) => updateConfig({ storage: parseInt(e.target.value) })}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>10GB</span>
          <span>2000GB</span>
        </div>
      </div>

      {/* CPU */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Cpu className="w-5 h-5 text-gray-400" />
          <label className="text-sm font-medium text-gray-300">
            CPU: {config.cpu} {config.cpu === 1 ? 'core' : 'cores'}
          </label>
          <span className="text-xs text-gray-500 ml-auto">
            ${(config.cpu * 3).toFixed(2)}/month
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 4, 8, 16].map((cores) => (
            <button
              key={cores}
              onClick={() => updateConfig({ cpu: cores })}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                config.cpu === cores
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {cores} {cores === 1 ? 'core' : 'cores'}
            </button>
          ))}
        </div>
      </div>

      {/* Memory */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Memory className="w-5 h-5 text-gray-400" />
          <label className="text-sm font-medium text-gray-300">
            Memory: {config.memory}GB
          </label>
          <span className="text-xs text-gray-500 ml-auto">
            ${(config.memory * 2.5).toFixed(2)}/month
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[2, 4, 8, 16, 32].map((memory) => (
            <button
              key={memory}
              onClick={() => updateConfig({ memory })}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                config.memory === memory
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {memory}GB
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// Languages Step Component
const LanguagesStep: React.FC<{
  config: ContainerConfig;
  updateConfig: (updates: Partial<ContainerConfig>) => void;
}> = ({ config, updateConfig }) => {
  const languages = [
    { key: 'nodejs', name: 'Node.js', price: 3, color: 'text-green-400', description: 'JavaScript runtime built on Chrome\'s V8 engine' },
    { key: 'python', name: 'Python', price: 3, color: 'text-blue-400', description: 'High-level programming language for rapid development' },
    { key: 'go', name: 'Go', price: 2, color: 'text-cyan-400', description: 'Statically typed, compiled programming language' },
    { key: 'rust', name: 'Rust', price: 2, color: 'text-orange-400', description: 'Systems programming language focused on safety and performance' },
    { key: 'java', name: 'Java', price: 4, color: 'text-red-400', description: 'Object-oriented programming language and platform' },
  ];

  const toggleLanguage = (langKey: keyof LanguageConfig) => {
    updateConfig({
      languages: {
        ...config.languages,
        [langKey]: !config.languages[langKey],
      },
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-gray-400 mb-4">
        Select the programming languages and runtimes you need. Each selection includes
        the language runtime, package manager, and essential development tools.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {languages.map((lang) => (
          <div
            key={lang.key}
            onClick={() => toggleLanguage(lang.key as keyof LanguageConfig)}
            className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
              config.languages[lang.key as keyof LanguageConfig]
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-gray-600 bg-gray-800 hover:border-gray-500'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className={`text-2xl font-bold ${lang.color}`}>
                  {lang.name}
                </div>
                {config.languages[lang.key as keyof LanguageConfig] && (
                  <Check className="w-5 h-5 text-green-400" />
                )}
              </div>
              <div className="text-right">
                <div className="text-sm font-medium text-gray-300">
                  ${lang.price.toFixed(2)}/month
                </div>
              </div>
            </div>
            <p className="text-sm text-gray-400">{lang.description}</p>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="mt-6 p-4 bg-gray-800 rounded-lg">
        <h4 className="font-medium text-white mb-2">Selected Languages</h4>
        {Object.entries(config.languages).filter(([_, enabled]) => enabled).length === 0 ? (
          <p className="text-gray-400">No languages selected</p>
        ) : (
          <div className="space-y-1">
            {Object.entries(config.languages)
              .filter(([_, enabled]) => enabled)
              .map(([key]) => {
                const lang = languages.find(l => l.key === key);
                return (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-gray-300">{lang?.name}</span>
                    <span className="text-sm text-gray-400">${lang?.price}/month</span>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
};

// Collaboration Step Component
const CollaborationStep: React.FC<{
  config: ContainerConfig;
  updateConfig: (updates: Partial<ContainerConfig>) => void;
}> = ({ config, updateConfig }) => {
  return (
    <div className="space-y-6">
      <p className="text-gray-400">
        Configure collaboration features for multi-user development sessions.
      </p>

      {/* Max Users */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Users className="w-5 h-5 text-gray-400" />
          <label className="text-sm font-medium text-gray-300">
            Maximum Users: {config.maxUsers}
          </label>
          <span className="text-xs text-gray-500 ml-auto">
            ${(config.maxUsers * 2).toFixed(2)}/month
          </span>
        </div>
        <input
          type="range"
          min="1"
          max="25"
          value={config.maxUsers}
          onChange={(e) => updateConfig({ maxUsers: parseInt(e.target.value) })}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>1 user</span>
          <span>25 users</span>
        </div>
        <p className="text-sm text-gray-400 mt-2">
          Each user slot allows one person to join collaborative sessions.
        </p>
      </div>

      {/* Real-time Sync */}
      <div className="p-4 bg-gray-800 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-medium text-white">Real-time Synchronization</h4>
            <p className="text-sm text-gray-400 mt-1">
              Live cursors, file changes, and collaborative editing
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Check className="w-5 h-5 text-green-400" />
            <span className="text-green-400 font-medium">Included</span>
          </div>
        </div>
      </div>

      {/* Collaboration Features */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 bg-gray-800 rounded-lg">
          <div className="text-blue-400 mb-2">
            <Users className="w-6 h-6" />
          </div>
          <h4 className="font-medium text-white">Multi-user Sessions</h4>
          <p className="text-sm text-gray-400 mt-1">
            Multiple developers working together in real-time
          </p>
        </div>
        
        <div className="p-4 bg-gray-800 rounded-lg">
          <div className="text-green-400 mb-2">
            <Code className="w-6 h-6" />
          </div>
          <h4 className="font-medium text-white">Live Code Editing</h4>
          <p className="text-sm text-gray-400 mt-1">
            See changes instantly as team members edit files
          </p>
        </div>
        
        <div className="p-4 bg-gray-800 rounded-lg">
          <div className="text-purple-400 mb-2">
            <Server className="w-6 h-6" />
          </div>
          <h4 className="font-medium text-white">Shared Terminal</h4>
          <p className="text-sm text-gray-400 mt-1">
            Collaborative command-line sessions
          </p>
        </div>
      </div>
    </div>
  );
};

// Features Step Component
const FeaturesStep: React.FC<{
  config: ContainerConfig;
  updateConfig: (updates: Partial<ContainerConfig>) => void;
}> = ({ config, updateConfig }) => {
  const features = [
    {
      key: 'backups',
      name: 'Automated Backups',
      price: 5,
      icon: <Backup className="w-6 h-6" />,
      color: 'text-green-400',
      description: 'Daily automated backups with 30-day retention',
    },
    {
      key: 'encryption',
      name: 'Data Encryption',
      price: 3,
      icon: <Shield className="w-6 h-6" />,
      color: 'text-blue-400',
      description: 'End-to-end encryption for all data and communications',
    },
    {
      key: 'prioritySupport',
      name: 'Priority Support',
      price: 10,
      icon: <Headphones className="w-6 h-6" />,
      color: 'text-purple-400',
      description: '24/7 priority support with dedicated engineering team',
    },
  ];

  const toggleFeature = (featureKey: string) => {
    updateConfig({
      [featureKey]: !config[featureKey as keyof ContainerConfig],
    });
  };

  return (
    <div className="space-y-6">
      <p className="text-gray-400">
        Add premium features to enhance security, reliability, and support.
      </p>

      <div className="space-y-4">
        {features.map((feature) => (
          <div
            key={feature.key}
            onClick={() => toggleFeature(feature.key)}
            className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
              config[feature.key as keyof ContainerConfig]
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-gray-600 bg-gray-800 hover:border-gray-500'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={feature.color}>
                  {feature.icon}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-white">{feature.name}</h4>
                    {config[feature.key as keyof ContainerConfig] && (
                      <Check className="w-5 h-5 text-green-400" />
                    )}
                  </div>
                  <p className="text-sm text-gray-400 mt-1">{feature.description}</p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-medium text-gray-300">
                  ${feature.price.toFixed(2)}
                </div>
                <div className="text-xs text-gray-500">per month</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Review Step Component
const ReviewStep: React.FC<{
  config: ContainerConfig;
  monthlyPrice: number;
  validation: { valid: boolean; errors: string[] };
}> = ({ config, monthlyPrice, validation }) => {
  return (
    <div className="space-y-6">
      {/* Configuration Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Resources */}
        <div className="bg-gray-800 p-4 rounded-lg">
          <h4 className="font-medium text-white mb-3 flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-400" />
            Resources
          </h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Storage</span>
              <span className="text-white">{config.storage}GB</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">CPU</span>
              <span className="text-white">{config.cpu} {config.cpu === 1 ? 'core' : 'cores'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Memory</span>
              <span className="text-white">{config.memory}GB</span>
            </div>
          </div>
        </div>

        {/* Languages */}
        <div className="bg-gray-800 p-4 rounded-lg">
          <h4 className="font-medium text-white mb-3 flex items-center gap-2">
            <Code className="w-5 h-5 text-green-400" />
            Languages
          </h4>
          <div className="space-y-1 text-sm">
            {Object.entries(config.languages)
              .filter(([_, enabled]) => enabled)
              .map(([key, _]) => (
                <div key={key} className="text-gray-300 capitalize">
                  {key}
                </div>
              ))}
          </div>
        </div>

        {/* Collaboration */}
        <div className="bg-gray-800 p-4 rounded-lg">
          <h4 className="font-medium text-white mb-3 flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-400" />
            Collaboration
          </h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Max Users</span>
              <span className="text-white">{config.maxUsers}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Real-time Sync</span>
              <span className="text-green-400">Included</span>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="bg-gray-800 p-4 rounded-lg">
          <h4 className="font-medium text-white mb-3 flex items-center gap-2">
            <Shield className="w-5 h-5 text-yellow-400" />
            Premium Features
          </h4>
          <div className="space-y-1 text-sm">
            {config.backups && <div className="text-gray-300">Automated Backups</div>}
            {config.encryption && <div className="text-gray-300">Data Encryption</div>}
            {config.prioritySupport && <div className="text-gray-300">Priority Support</div>}
            {!config.backups && !config.encryption && !config.prioritySupport && (
              <div className="text-gray-400">No premium features selected</div>
            )}
          </div>
        </div>
      </div>

      {/* Pricing Breakdown */}
      <div className="bg-gradient-to-r from-green-500/10 to-blue-500/10 border border-green-500/20 rounded-lg p-6">
        <h4 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Calculator className="w-6 h-6 text-green-400" />
          Monthly Cost Breakdown
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-300">Storage ({config.storage}GB)</span>
              <span className="text-white font-mono">${(config.storage * 0.1).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">CPU ({config.cpu} cores)</span>
              <span className="text-white font-mono">${(config.cpu * 3).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">Memory ({config.memory}GB)</span>
              <span className="text-white font-mono">${(config.memory * 2.5).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-300">Users ({config.maxUsers})</span>
              <span className="text-white font-mono">${(config.maxUsers * 2).toFixed(2)}</span>
            </div>
          </div>
          <div className="space-y-2">
            {Object.entries(config.languages).filter(([_, enabled]) => enabled).map(([lang]) => (
              <div key={lang} className="flex justify-between">
                <span className="text-gray-300 capitalize">{lang} Runtime</span>
                <span className="text-white font-mono">
                  ${lang === 'java' ? '4.00' : lang === 'go' || lang === 'rust' ? '2.00' : '3.00'}
                </span>
              </div>
            ))}
            {config.backups && (
              <div className="flex justify-between">
                <span className="text-gray-300">Automated Backups</span>
                <span className="text-white font-mono">$5.00</span>
              </div>
            )}
            {config.encryption && (
              <div className="flex justify-between">
                <span className="text-gray-300">Data Encryption</span>
                <span className="text-white font-mono">$3.00</span>
              </div>
            )}
            {config.prioritySupport && (
              <div className="flex justify-between">
                <span className="text-gray-300">Priority Support</span>
                <span className="text-white font-mono">$10.00</span>
              </div>
            )}
          </div>
        </div>
        <div className="border-t border-gray-600 mt-4 pt-4">
          <div className="flex justify-between items-center">
            <span className="text-xl font-bold text-white">Total Monthly Cost</span>
            <span className="text-3xl font-bold text-green-400 font-mono">
              {formatPrice(monthlyPrice)}
            </span>
          </div>
        </div>
      </div>

      {/* Validation Errors */}
      {!validation.valid && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <h4 className="font-medium text-red-400 mb-2">Configuration Issues</h4>
          <ul className="space-y-1">
            {validation.errors.map((error, index) => (
              <li key={index} className="text-sm text-red-300">• {error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Success Message */}
      {validation.valid && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
          <h4 className="font-medium text-green-400 mb-2">Ready to Create</h4>
          <p className="text-sm text-green-300">
            Your container configuration is valid and ready to be deployed. 
            Click "Create Container" to provision your development environment.
          </p>
        </div>
      )}
    </div>
  );
};

export default ContainerConfigurationWizard;