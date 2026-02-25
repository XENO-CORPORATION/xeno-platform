import React from 'react';
import { BaseImageModel } from '../BaseImageModel';
import { ImageModelSettings, ImageGenerationResponse } from '../ImageModelInterface';
import { generateImage, XenoModels, getXenoSettings } from '../../../../services/xenoImageService';
import { API_ENDPOINTS } from '../../../../config/apiConfig';

export class RecraftV3SVGModel extends BaseImageModel {
  id = 'recraft-v3-svg';
  name = 'Recraft V3 SVG';
  description = 'Recraft V3 Scalable Vector Graphics generator';
  provider = 'Replicate';
  
  supportedResolutions = [
    '1024x1024', // Square 1:1
    '1365x1024', // Landscape Wide
    '1024x1365', // Portrait Tall
    '1536x1024', // Landscape
    '1024x1536', // Portrait
    '1820x1024', // Ultra Wide
    '1024x1820', // Ultra Tall
    '2048x1024', // Panoramic
    '1024x2048', // Vertical Panoramic
    '1434x1024', // Cinema
    '1024x1434', // Vertical Cinema
    '1280x1024', // HD
    '1024x1280', // Vertical HD
    '1024x1707', // Poster
    '1707x1024'  // Horizontal Poster
  ];
  
  defaultSettings: ImageModelSettings = {
    resolution: '1024x1024',
    steps: 30,
    guidance: 8,
    style: 'any'
  };
  
  async generateImage(prompt: string, settings: ImageModelSettings): Promise<{ imageUrl: string; metadata?: any }> {
    console.log("Generating SVG with Recraft V3 SVG model...");
    console.log("Prompt:", prompt);
    console.log("Model details:", this.id, this.name);
    console.log("API endpoint:", API_ENDPOINTS.REPLICATE_API);
    
    // Ensure we use the exact format required for size parameter
    const size = settings.size || 
                 (settings.width && settings.height ? `${settings.width}x${settings.height}` : settings.resolution) || 
                 '1024x1024';
    
    // Ensure style parameter is one of the supported values
    const style = settings.style || 'any';
    if (style !== 'any' && 
        style !== 'engraving' && 
        style !== 'line_art' && 
        style !== 'line_circuit' && 
        style !== 'linocut') {
      console.warn(`Style "${style}" not supported by Recraft V3 SVG. Defaulting to "any".`);
    }
    
    // Note: Replicate API parameters for the SVG model
    const modelParams = {
      prompt: prompt,
      size: size,
      style: style
    };
    
    // Generate the SVG content
    const modelConfig = {
      model: XenoModels.RECRAFT_V3_SVG.model,
      version: XenoModels.RECRAFT_V3_SVG.version,
      description: this.description
    };
    
    const replicateSettings = {
      ...getXenoSettings(settings, XenoModels.RECRAFT_V3_SVG.model),
      ...modelParams
    };
    
    const result = await generateImage(modelConfig, prompt, replicateSettings);
    
    // For SVG model, we expect the result to be a direct SVG string or URL
    let svgUrl = result.imageUrl;
    
    // Validate that we have a valid SVG URL or content
    if (!svgUrl || svgUrl.length < 10 || (!svgUrl.includes('http') && !svgUrl.includes('<svg'))) {
      console.error("Invalid SVG output:", result);
      throw new Error('Failed to generate a valid SVG. Please try again.');
    }
    
    console.log("Successfully generated SVG:", svgUrl.substring(0, 100) + '...');
    
    return {
      imageUrl: svgUrl,
      metadata: {
        modelVersion: this.name,
        prompt: prompt,
        negativePrompt: '',
        steps: settings.steps,
        guidance: settings.guidance,
        seed: settings.seed || -1,
        size: size,
        style: style,
        generationTime: 0 // We don't have access to metrics in this interface
      }
    };
  }
} 