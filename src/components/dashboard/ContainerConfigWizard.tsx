import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';
import { Badge } from '../ui/badge';
import { Slider } from '../ui/slider';
import { Checkbox } from '../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Calculator, Server, Code, Users, Shield, CheckCircle, ArrowRight, ArrowLeft } from 'lucide-react';

interface ContainerConfig {
  // Resources
  storage: number;
  cpu: number;
  memory: number;
  
  // Languages & Tools
  languages: {
    nodejs: boolean;
    python: boolean;
    go: boolean;
    rust: boolean;
    java: boolean;
  };
  
  // Collaboration
  maxUsers: number;
  realTimeSync: boolean;
  
  // Advanced
  backups: boolean;
  encryption: boolean;
  prioritySupport: boolean;
}

interface PricingBreakdown {
  resources: number;
  languages: number;
  collaboration: number;
  advanced: number;
  total: number;
}

const defaultConfig: ContainerConfig = {
  storage: 50,
  cpu: 2,
  memory: 4,
  languages: {
    nodejs: false,
    python: false,
    go: false,
    rust: false,
    java: false
  },
  maxUsers: 1,
  realTimeSync: true,
  backups: false,
  encryption: false,
  prioritySupport: false
};

const templates = {
  student: {
    name: "Student",
    description: "Perfect for learning and small projects",
    config: { ...defaultConfig, storage: 10, cpu: 1, memory: 2 },
    popular: false
  },
  developer: {
    name: "Developer",
    description: "Ideal for professional development",
    config: { ...defaultConfig, storage: 100, cpu: 4, memory: 8, languages: { nodejs: true, python: true, go: false, rust: false, java: false }, maxUsers: 3 },
    popular: true
  },
  team: {
    name: "Team",
    description: "Collaborative team environment",
    config: { ...defaultConfig, storage: 500, cpu: 8, memory: 16, languages: { nodejs: true, python: true, go: true, rust: false, java: true }, maxUsers: 10, backups: true },
    popular: false
  },
  enterprise: {
    name: "Enterprise",
    description: "Full-featured enterprise solution",
    config: { ...defaultConfig, storage: 2000, cpu: 16, memory: 32, languages: { nodejs: true, python: true, go: true, rust: true, java: true }, maxUsers: 25, backups: true, encryption: true, prioritySupport: true },
    popular: false
  }
};

const calculatePrice = (config: ContainerConfig): PricingBreakdown => {
  const resources = (config.storage * 0.1) + (config.cpu * 3) + (config.memory * 2.5);
  
  const languagePrices = {
    nodejs: 3, python: 3, go: 2, rust: 2, java: 4
  };
  
  const languages = Object.entries(config.languages)
    .filter(([_, enabled]) => enabled)
    .reduce((sum, [lang, _]) => sum + languagePrices[lang as keyof typeof languagePrices], 0);
  
  const collaboration = config.maxUsers * 2;
  
  const advanced = 
    (config.backups ? 5 : 0) + 
    (config.encryption ? 3 : 0) + 
    (config.prioritySupport ? 10 : 0);
  
  const total = resources + languages + collaboration + advanced;
  
  return { resources, languages, collaboration, advanced, total };
};

export const ContainerConfigWizard: React.FC<{
  onComplete: (config: ContainerConfig) => void;
  onCancel: () => void;
}> = ({ onComplete, onCancel }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [config, setConfig] = useState<ContainerConfig>(defaultConfig);
  const [pricing, setPricing] = useState<PricingBreakdown>(calculatePrice(defaultConfig));
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    setPricing(calculatePrice(config));
  }, [config]);

  useEffect(() => {
    // Validate the current step whenever step or languages change
    const currentStepData = steps[currentStep];
    
    if (currentStepData && currentStepData.id === 'languages') { // Languages step
      const hasLanguageSelected = Object.values(config.languages).some(enabled => enabled);
      if (!hasLanguageSelected) {
        setValidationErrors(['Please select at least one programming language to continue']);
      } else {
        setValidationErrors([]);
      }
    } else {
      setValidationErrors([]);
    }
  }, [currentStep, config.languages]);

  const steps = [
    { id: 'template', title: 'Choose Template', icon: Server },
    { id: 'resources', title: 'Configure Resources', icon: Calculator },
    { id: 'languages', title: 'Select Languages', icon: Code },
    { id: 'collaboration', title: 'Team Settings', icon: Users },
    { id: 'advanced', title: 'Advanced Features', icon: Shield },
    { id: 'summary', title: 'Review & Deploy', icon: CheckCircle }
  ];

  const validateCurrentStep = (): string[] => {
    const errors: string[] = [];
    const currentStepData = steps[currentStep];

    if (currentStepData && currentStepData.id === 'languages') { // Languages step
      const hasLanguageSelected = Object.values(config.languages).some(enabled => enabled);
      if (!hasLanguageSelected) {
        errors.push('Please select at least one programming language to continue');
      }
    }

    return errors;
  };

  const nextStep = () => {
    const errors = validateCurrentStep();
    setValidationErrors(errors);

    if (errors.length > 0) {
      return; // Don't proceed if there are validation errors
    }

    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const applyTemplate = (templateKey: string) => {
    const template = templates[templateKey as keyof typeof templates];
    setConfig(template.config);
    setSelectedTemplate(templateKey);
    nextStep();
  };

  const updateConfig = (updates: Partial<ContainerConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  };

  const updateLanguages = (lang: keyof ContainerConfig['languages'], enabled: boolean) => {
    setConfig(prev => ({
      ...prev,
      languages: { ...prev.languages, [lang]: enabled }
    }));
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0: // Template Selection
        return (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold mb-2">Choose Your Starting Template</h2>
              <p className="text-gray-600">Select a pre-configured template to get started quickly</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {Object.entries(templates).map(([key, template]) => (
                <Card 
                  key={key}
                  className={`cursor-pointer transition-all duration-200 hover:scale-105 ${
                    template.popular ? 'ring-2 ring-blue-500' : ''
                  }`}
                  onClick={() => applyTemplate(key)}
                >
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{template.name}</CardTitle>
                      {template.popular && <Badge variant="default">Popular</Badge>}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-gray-600 mb-4">{template.description}</p>
                    <div className="text-2xl font-bold text-green-600">
                      ${calculatePrice(template.config).total}/month
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );

      case 1: // Resources
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold mb-4">Configure Resources</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Storage: {config.storage}GB ($0.10/GB)
                </label>
                <Slider
                  value={[config.storage]}
                  onValueChange={([value]) => updateConfig({ storage: value })}
                  min={10}
                  max={2000}
                  step={10}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>10GB</span>
                  <span>2TB</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  CPU Cores: {config.cpu} ($3/core)
                </label>
                <Slider
                  value={[config.cpu]}
                  onValueChange={([value]) => updateConfig({ cpu: value })}
                  min={1}
                  max={16}
                  step={1}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>1 core</span>
                  <span>16 cores</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Memory: {config.memory}GB ($2.50/GB)
                </label>
                <Slider
                  value={[config.memory]}
                  onValueChange={([value]) => updateConfig({ memory: value })}
                  min={2}
                  max={32}
                  step={2}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>2GB</span>
                  <span>32GB</span>
                </div>
              </div>
            </div>
          </div>
        );

      case 2: // Languages
        const hasLanguageSelected = Object.values(config.languages).some(enabled => enabled);
        return (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold mb-2">Select Development Languages</h2>
              <p className="text-gray-600">Choose the programming languages and runtimes you need</p>
            </div>

            {validationErrors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  <p className="text-red-800 text-sm font-medium">
                    {validationErrors[0]}
                  </p>
                </div>
              </div>
            )}

            {!hasLanguageSelected && validationErrors.length === 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
                  <p className="text-amber-800 text-sm font-medium">
                    Please select at least one programming language to continue
                  </p>
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-4">
              {Object.entries({
                nodejs: { name: 'Node.js', price: 3, icon: '⚡' },
                python: { name: 'Python', price: 3, icon: '🐍' },
                go: { name: 'Go', price: 2, icon: '🚀' },
                rust: { name: 'Rust', price: 2, icon: '🦀' },
                java: { name: 'Java', price: 4, icon: '☕' }
              }).map(([key, lang]) => (
                <Card key={key} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <span className="text-2xl">{lang.icon}</span>
                      <div>
                        <div className="font-medium">{lang.name}</div>
                        <div className="text-sm text-gray-500">${lang.price}/month</div>
                      </div>
                    </div>
                    <Checkbox
                      checked={config.languages[key as keyof typeof config.languages]}
                      onCheckedChange={(checked) => updateLanguages(key as keyof typeof config.languages, checked as boolean)}
                    />
                  </div>
                </Card>
              ))}
            </div>
          </div>
        );

      case 3: // Collaboration
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold mb-4">Team & Collaboration</h2>
            
            <div>
              <label className="block text-sm font-medium mb-2">
                Maximum Users: {config.maxUsers} ($2/user)
              </label>
              <Slider
                value={[config.maxUsers]}
                onValueChange={([value]) => updateConfig({ maxUsers: value })}
                min={1}
                max={25}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>1 user</span>
                <span>25 users</span>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <div className="font-medium">Real-Time Synchronization</div>
                <div className="text-sm text-gray-500">Live cursors, file sync, and collaboration</div>
              </div>
              <div className="text-green-600 font-medium">Included</div>
            </div>
          </div>
        );

      case 4: // Advanced
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold mb-4">Advanced Features</h2>
            
            <div className="space-y-4">
              {/*
                Three paid add-ons were removed here on 2026-07-29, together
                $18/month, because none of them did anything.

                'Data Encryption' ($3, "AES-256 encryption at rest and in transit")
                and 'Automated Backups' ($5, "Daily snapshots with 30-day
                retention") were priced in containerRoutes.js, added to the billed
                total, and then implemented by setting ENCRYPTION_ENABLED= and
                BACKUP_ENABLED= as container environment variables. Both variables
                are written and never read — there is no grep hit that consumes
                either, no snapshot mechanism, and the volume is a plain Docker
                mount. 'Priority Support' promised "24/7 support with <2 hour
                response time", which no one has undertaken to provide.

                Verified before removing: 0 of the 2 containers that have ever
                existed carried any add-on, so no customer was charged and no
                refund is owed. Do not re-add a line here until the feature it
                names is real — a paid feature that silently does nothing is the
                worst version of this defect, because money changes hands.

                The server still tolerates absent add-on flags, so legacy configs
                keep working.
              */}
              <Card className="p-4">
                <div className="font-medium">No paid add-ons are available yet</div>
                <div className="text-sm text-gray-500 mt-1">
                  Your container is provisioned with the storage, users and languages you chose on the
                  previous steps. Additional options will appear here once they are implemented.
                </div>
              </Card>
            </div>
          </div>
        );

      case 5: // Summary
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold mb-4">Review Your Configuration</h2>
            
            <div className="grid grid-cols-2 gap-6">
              <Card className="p-6">
                <h3 className="text-lg font-medium mb-4">Configuration Summary</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span>Storage</span>
                    <span>{config.storage}GB</span>
                  </div>
                  <div className="flex justify-between">
                    <span>CPU</span>
                    <span>{config.cpu} cores</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Memory</span>
                    <span>{config.memory}GB</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Languages</span>
                    <span>{Object.values(config.languages).filter(Boolean).length} selected</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Max Users</span>
                    <span>{config.maxUsers}</span>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <h3 className="text-lg font-medium mb-4">Pricing Breakdown</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span>Resources</span>
                    <span>${pricing.resources.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Languages</span>
                    <span>${pricing.languages.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Collaboration</span>
                    <span>${pricing.collaboration.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Advanced</span>
                    <span>${pricing.advanced.toFixed(2)}</span>
                  </div>
                  <hr className="border-gray-200" />
                  <div className="flex justify-between font-bold text-lg">
                    <span>Total</span>
                    <span className="text-green-600">${pricing.total.toFixed(2)}/month</span>
                  </div>
                </div>
              </Card>
            </div>

            <div className="bg-blue-50 p-4 rounded-lg">
              <h4 className="font-medium text-blue-900 mb-2">Ready to Deploy!</h4>
              <p className="text-sm text-blue-700">
                Your container will be ready in approximately 30 seconds after clicking "Deploy Now".
                You can modify this configuration at any time with zero downtime.
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Container Configuration Wizard</h1>
              <p className="text-blue-100">Configure your development environment in 30 seconds</p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold">${pricing.total.toFixed(2)}</div>
              <div className="text-sm text-blue-100">per month</div>
            </div>
          </div>
          
          {/* Progress */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm">Step {currentStep + 1} of {steps.length}</span>
              <span className="text-sm">{Math.round(((currentStep + 1) / steps.length) * 100)}% Complete</span>
            </div>
            <Progress value={((currentStep + 1) / steps.length) * 100} className="bg-blue-500" />
          </div>
        </div>

        {/* Content */}
        <div className="p-6 flex-1 overflow-auto" style={{ maxHeight: '60vh' }}>
          {renderStep()}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 flex items-center justify-between border-t">
          <Button 
            variant="outline" 
            onClick={currentStep === 0 ? onCancel : prevStep}
            className="flex items-center space-x-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{currentStep === 0 ? 'Cancel' : 'Previous'}</span>
          </Button>
          
          <div className="flex items-center space-x-4">
            <div className="text-right">
              <div className="text-2xl font-bold text-green-600">
                ${pricing.total.toFixed(2)}/month
              </div>
              <div className="text-sm text-gray-500">
                {pricing.total > 0 && `$${(pricing.total / 30).toFixed(2)}/day`}
              </div>
            </div>
            
            <Button
              onClick={currentStep === steps.length - 1 ? () => onComplete(config) : nextStep}
              disabled={validationErrors.length > 0}
              className={`flex items-center space-x-2 ${
                validationErrors.length > 0
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-600 to-purple-600'
              }`}
            >
              <span>{currentStep === steps.length - 1 ? 'Deploy Now' : 'Next'}</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};