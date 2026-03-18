#!/bin/bash
# Generate documentation pages for all XENO products
# This script creates the docs/index.html for each product

BASE="X:/code/xeno-corporation/xeno-platform/public/products"

# Product definitions: slug|name|category|description|sections
declare -a PRODUCTS=(
  "pixel|XENO Pixel|Creative Suite|Professional image editor with AI-powered tools|getting-started,layers,brushes,selections,filters,ai-generation,vector-tools,export"
  "motion|XENO Motion|Creative Suite|Professional video editor and compositor|getting-started,timeline,color-grading,effects,motion-graphics,audio,ai-editing,export"
  "sound|XENO Sound|Creative Suite|Digital audio workstation with AI audio tools|getting-started,tracks,recording,mixing,effects,mastering,ai-audio,export"
  "hub|XENO Hub|Platform|Desktop launcher and AI workspace|getting-started,app-launcher,agents,models,credits,settings,workspaces,updates"
  "agent-cli|XENO Agent CLI|Platform|Terminal AI agent for autonomous operations|getting-started,installation,configuration,commands,tools,sessions,scripting,api"
  "3d|XENO 3D|Creative Suite|AI-native 3D modeling animation and rendering|getting-started,modeling,sculpting,uv-mapping,materials,animation,rendering,export"
  "architect|XENO Architect|Creative Suite|AI-native architecture and CAD tool|getting-started,bim,parametric,drafting-2d,viewport-3d,ai-plans,ifc,export"
  "engine|XENO Engine|Creative Suite|AI-native game engine|getting-started,ecs,rendering,physics,scripting,visual-scripting,multiplayer,export"
  "workflow|XENO Workflow|Creative Suite|Visual workflow automation tool|getting-started,nodes,pipelines,connections,triggers,templates,api,export"
  "lib|XENO Lib|Platform|AI model library with 17 integrated models|getting-started,installation,image-generation,upscaling,segmentation,depth,api-reference,model-formats"
)

echo "Generating documentation pages..."

for product_def in "${PRODUCTS[@]}"; do
  IFS='|' read -r slug name category desc sections <<< "$product_def"
  
  # Convert sections to sidebar items
  IFS=',' read -ra SECTION_ARRAY <<< "$sections"
  
  SIDEBAR_ITEMS=""
  CONTENT_SECTIONS=""
  for section in "${SECTION_ARRAY[@]}"; do
    # Convert kebab-case to Title Case
    title=$(echo "$section" | sed 's/-/ /g' | sed 's/\b\(.\)/\u\1/g')
    SIDEBAR_ITEMS="${SIDEBAR_ITEMS}<a href=\"#${section}\" class=\"sidebar-link\" data-section=\"${section}\">${title}</a>"
    CONTENT_SECTIONS="${CONTENT_SECTIONS}
      <section id=\"${section}\" class=\"doc-section\">
        <h2>${title}</h2>
        <p class=\"doc-placeholder\">Documentation for ${title} is being written. Check back soon or contribute on <a href=\"https://github.com/XENO-CORPORATION\" style=\"color:rgba(255,255,255,0.7)\">GitHub</a>.</p>
      </section>"
  done
  
  # Check if shortcuts page should exist (not for lib)
  SHORTCUTS_LINK=""
  if [ "$slug" != "lib" ]; then
    SHORTCUTS_LINK="<a href=\"/products/${slug}/docs/shortcuts/\" class=\"sidebar-link\" data-section=\"shortcuts\">Keyboard Shortcuts</a>"
  fi

  echo "  Creating docs for ${name}..."
done

echo "Done."
