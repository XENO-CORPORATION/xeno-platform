/**
 * XenoOS Real-time Price Calculator Component
 * Interactive pricing calculator for container configurations
 */

import React, { useState, useEffect } from 'react';
import { 
  Calculator, 
  TrendingUp, 
  TrendingDown, 
  DollarSign,
  Zap,
  Info,
  CheckCircle2
} from 'lucide-react';
import { ContainerConfig } from '../../../types/container';
import { 
  calculateMonthlyPrice, 
  calculatePricingBreakdown, 
  formatPrice,
  getConfigurationSuggestions,
  calculatePriceDifference 
} from '../../../utils/containerPricing';

interface PriceCalculatorProps {
  config: ContainerConfig;
  onConfigChange?: (config: ContainerConfig) => void;
  showBreakdown?: boolean;
  showSuggestions?: boolean;
  className?: string;
}

const PriceCalculator: React.FC<PriceCalculatorProps> = ({
  config,
  onConfigChange,
  showBreakdown = true,
  showSuggestions = true,
  className = ''
}) => {
  const [breakdown, setBreakdown] = useState(calculatePricingBreakdown(config));
  const [selectedSuggestion, setSelectedSuggestion] = useState<string | null>(null);
  const [previousConfig, setPreviousConfig] = useState<ContainerConfig>(config);

  useEffect(() => {
    const newBreakdown = calculatePricingBreakdown(config);
    setBreakdown(newBreakdown);
  }, [config]);

  const suggestions = {
    student: getConfigurationSuggestions('student'),
    developer: getConfigurationSuggestions('developer'),
    team: getConfigurationSuggestions('team'),
    enterprise: getConfigurationSuggestions('enterprise'),
  };

  const priceDiff = calculatePriceDifference(previousConfig, config);

  const handleSuggestionSelect = (suggestionKey: string) => {
    if (onConfigChange) {
      const suggestion = suggestions[suggestionKey as keyof typeof suggestions];
      setPreviousConfig(config);
      setSelectedSuggestion(suggestionKey);
      onConfigChange(suggestion);
    }
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Main Price Display */}
      <div className="bg-gradient-to-r from-blue-500/10 to-green-500/10 border border-blue-500/20 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center">
              <Calculator className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Monthly Cost</h3>
              <p className="text-gray-400">Real-time pricing calculation</p>
            </div>
          </div>
          
          {/* Price Change Indicator */}
          {priceDiff.difference > 0 && (
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${
              priceDiff.isIncrease 
                ? 'bg-red-500/20 text-red-400' 
                : 'bg-green-500/20 text-green-400'
            }`}>
              {priceDiff.isIncrease ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              <span className="text-sm font-medium">
                ${priceDiff.difference.toFixed(2)} ({priceDiff.percentChange.toFixed(1)}%)
              </span>
            </div>
          )}
        </div>
        
        <div className="text-center">
          <div className="text-5xl font-bold text-green-400 font-mono mb-2">
            {formatPrice(breakdown.total)}
          </div>
          <div className="text-gray-400">per month</div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-600">
          <div className="text-center">
            <div className="text-lg font-bold text-blue-400">{config.storage}GB</div>
            <div className="text-xs text-gray-400">Storage</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-purple-400">{config.cpu}</div>
            <div className="text-xs text-gray-400">CPU Cores</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-yellow-400">{config.memory}GB</div>
            <div className="text-xs text-gray-400">Memory</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-green-400">{config.maxUsers}</div>
            <div className="text-xs text-gray-400">Users</div>
          </div>
        </div>
      </div>

      {/* Pricing Breakdown */}
      {showBreakdown && (
        <div className="bg-gray-800 rounded-xl p-6">
          <h4 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-green-400" />
            Cost Breakdown
          </h4>
          
          <div className="space-y-3">
            {/* Base Resources */}
            <div className="bg-gray-700 rounded-lg p-4">
              <h5 className="font-medium text-white mb-3">Base Resources</h5>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-300">Storage ({config.storage}GB)</span>
                  <span className="text-white font-mono">
                    {formatPrice(breakdown.breakdown.storage)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">CPU ({config.cpu} cores)</span>
                  <span className="text-white font-mono">
                    {formatPrice(breakdown.breakdown.cpu)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">Memory ({config.memory}GB)</span>
                  <span className="text-white font-mono">
                    {formatPrice(breakdown.breakdown.memory)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">User Slots ({config.maxUsers})</span>
                  <span className="text-white font-mono">
                    {formatPrice(breakdown.breakdown.users)}
                  </span>
                </div>
              </div>
              <div className="border-t border-gray-600 mt-3 pt-3">
                <div className="flex justify-between font-medium">
                  <span className="text-white">Subtotal</span>
                  <span className="text-green-400 font-mono">
                    {formatPrice(breakdown.baseResources)}
                  </span>
                </div>
              </div>
            </div>

            {/* Language Features */}
            {breakdown.languages > 0 && (
              <div className="bg-gray-700 rounded-lg p-4">
                <h5 className="font-medium text-white mb-3">Programming Languages</h5>
                <div className="space-y-2 text-sm">
                  {Object.entries(breakdown.breakdown.languageFeatures)
                    .filter(([_, price]) => price > 0)
                    .map(([lang, price]) => (
                      <div key={lang} className="flex justify-between">
                        <span className="text-gray-300 capitalize">{lang} Runtime</span>
                        <span className="text-white font-mono">
                          {formatPrice(price)}
                        </span>
                      </div>
                    ))}
                </div>
                <div className="border-t border-gray-600 mt-3 pt-3">
                  <div className="flex justify-between font-medium">
                    <span className="text-white">Subtotal</span>
                    <span className="text-green-400 font-mono">
                      {formatPrice(breakdown.languages)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Premium Features */}
            {breakdown.features > 0 && (
              <div className="bg-gray-700 rounded-lg p-4">
                <h5 className="font-medium text-white mb-3">Premium Features</h5>
                <div className="space-y-2 text-sm">
                  {breakdown.breakdown.advancedFeatures.backups > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-300">Automated Backups</span>
                      <span className="text-white font-mono">
                        {formatPrice(breakdown.breakdown.advancedFeatures.backups)}
                      </span>
                    </div>
                  )}
                  {breakdown.breakdown.advancedFeatures.encryption > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-300">Data Encryption</span>
                      <span className="text-white font-mono">
                        {formatPrice(breakdown.breakdown.advancedFeatures.encryption)}
                      </span>
                    </div>
                  )}
                  {breakdown.breakdown.advancedFeatures.prioritySupport > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-300">Priority Support</span>
                      <span className="text-white font-mono">
                        {formatPrice(breakdown.breakdown.advancedFeatures.prioritySupport)}
                      </span>
                    </div>
                  )}
                </div>
                <div className="border-t border-gray-600 mt-3 pt-3">
                  <div className="flex justify-between font-medium">
                    <span className="text-white">Subtotal</span>
                    <span className="text-green-400 font-mono">
                      {formatPrice(breakdown.features)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Included Features */}
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
              <h5 className="font-medium text-green-400 mb-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Included Features
              </h5>
              <div className="space-y-1 text-sm text-green-300">
                <div>✓ Real-time collaboration and synchronization</div>
                <div>✓ Full Ubuntu desktop environment</div>
                <div>✓ Terminal access and package management</div>
                <div>✓ File sharing and permissions</div>
                <div>✓ Basic monitoring and analytics</div>
              </div>
            </div>

            {/* Total */}
            <div className="bg-gradient-to-r from-green-500/20 to-blue-500/20 border border-green-500/30 rounded-lg p-4">
              <div className="flex justify-between items-center">
                <span className="text-xl font-bold text-white">Total Monthly Cost</span>
                <span className="text-2xl font-bold text-green-400 font-mono">
                  {formatPrice(breakdown.total)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Configuration Suggestions */}
      {showSuggestions && (
        <div className="bg-gray-800 rounded-xl p-6">
          <h4 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400" />
            Quick Configurations
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Object.entries(suggestions).map(([key, suggestion]) => {
              const suggestionPrice = calculateMonthlyPrice(suggestion);
              const isSelected = selectedSuggestion === key;
              
              return (
                <button
                  key={key}
                  onClick={() => handleSuggestionSelect(key)}
                  className={`p-4 rounded-lg border-2 transition-all text-left ${
                    isSelected
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-gray-600 bg-gray-700 hover:border-gray-500 hover:bg-gray-650'
                  }`}
                >
                  <div className="mb-2">
                    <h5 className="font-medium text-white capitalize">{key}</h5>
                    <p className="text-xs text-gray-400 mt-1">{suggestion.description}</p>
                  </div>
                  
                  <div className="space-y-1 text-xs text-gray-300">
                    <div>{suggestion.cpu} CPU • {suggestion.memory}GB RAM • {suggestion.storage}GB</div>
                    <div className="text-yellow-400">
                      {Object.entries(suggestion.languages)
                        .filter(([_, enabled]) => enabled)
                        .map(([lang]) => lang)
                        .join(', ')}
                    </div>
                  </div>
                  
                  <div className="mt-3 pt-2 border-t border-gray-600">
                    <div className="text-lg font-bold text-green-400 font-mono">
                      {formatPrice(suggestionPrice)}
                    </div>
                    <div className="text-xs text-gray-400">per month</div>
                  </div>
                </button>
              );
            })}
          </div>
          
          <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-blue-300">
                <strong>Quick Start:</strong> Select a pre-configured template to get started instantly, 
                or customize your own configuration using the wizard.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cost Comparison */}
      <div className="bg-gray-800 rounded-xl p-6">
        <h4 className="text-lg font-bold text-white mb-4">Cost Comparison</h4>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-700 rounded-lg p-4">
            <h5 className="font-medium text-gray-300 mb-2">GitHub Codespaces</h5>
            <div className="text-xl font-bold text-red-400 font-mono">$0.36/hour</div>
            <div className="text-xs text-gray-400 mt-1">~$260/month (full-time)</div>
          </div>
          
          <div className="bg-gray-700 rounded-lg p-4">
            <h5 className="font-medium text-gray-300 mb-2">Gitpod</h5>
            <div className="text-xl font-bold text-orange-400 font-mono">$39/month</div>
            <div className="text-xs text-gray-400 mt-1">50 hours limit</div>
          </div>
          
          <div className="bg-gradient-to-r from-green-500/20 to-blue-500/20 border border-green-500/20 rounded-lg p-4">
            <h5 className="font-medium text-green-300 mb-2">XenoOS</h5>
            <div className="text-xl font-bold text-green-400 font-mono">
              {formatPrice(breakdown.total)}
            </div>
            <div className="text-xs text-green-300 mt-1">Unlimited usage</div>
          </div>
        </div>
        
        <div className="mt-4 text-center">
          <div className="text-lg font-medium text-green-400">
            Save up to {Math.max(0, Math.round(((260 - breakdown.total) / 260) * 100))}% 
            compared to hourly pricing models
          </div>
        </div>
      </div>
    </div>
  );
};

export default PriceCalculator;