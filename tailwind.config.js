/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
  	extend: {
  		colors: {
  			'primary-bg': '#121212',
  			'secondary-bg': '#1E1E1E',
  			'text-primary': '#FFFFFF',
  			'text-secondary': '#E0E0E0',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			}
  		},
  		animation: {
  			shimmer: 'shimmer 2s infinite',
  			shimmerSlow: 'shimmerSlow 3s linear infinite',
  			'pulse-slow': 'pulse-slow 3s infinite',
  			float: 'float 6s ease-in-out infinite',
  			fadeIn: 'fadeIn 0.4s ease-out forwards',
  			pathDraw: 'pathDraw 2s forwards',
  			flowDash: 'flowDash 0.8s linear infinite',
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out',
  			'star-ring': 'star-ring 0.7s ease-out forwards',
  			'star-fill': 'star-fill 0.7s ease-out forwards',
  			'star-stroke': 'star-stroke 0.7s ease-out forwards',
  			'star-line': 'star-line 0.7s ease-out forwards',
  			'clock-spin': 'clock-spin 0.6s ease-out forwards',
  			'clock-tick': 'clock-tick 0.5s ease-out forwards',
  			'gear-spin': 'gear-spin 0.5s ease-out forwards'
  		},
  		keyframes: {
  			shimmer: {
  				'0%, 100%': {
  					opacity: 1
  				},
  				'50%': {
  					opacity: 0.5
  				}
  			},
  			shimmerSlow: {
  				'0%': {
  					backgroundPosition: '0% 0%'
  				},
  				'100%': {
  					backgroundPosition: '-200% 0%'
  				}
  			},
  			'pulse-slow': {
  				'0%, 100%': {
  					opacity: 1
  				},
  				'50%': {
  					opacity: 0.5
  				}
  			},
  			float: {
  				'0%, 100%': {
  					transform: 'translateY(0)'
  				},
  				'50%': {
  					transform: 'translateY(-10px)'
  				}
  			},
  			fadeIn: {
  				'0%': {
  					opacity: 0
  				},
  				'100%': {
  					opacity: 1
  				}
  			},
  			pathDraw: {
  				'0%': {
  					strokeDashoffset: 1000
  				},
  				'100%': {
  					strokeDashoffset: 0
  				}
  			},
  			flowDash: {
  				'0%': {
  					strokeDashoffset: 0
  				},
  				'100%': {
  					strokeDashoffset: '-30'
  				}
  			},
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			},
  			'star-ring': {
  				'0%, 20%': {
  					opacity: '1',
  					transform: 'scale(0)',
  					strokeWidth: '16'
  				},
  				'35%': {
  					opacity: '0.5',
  					transform: 'scale(1)',
  					strokeWidth: '16'
  				},
  				'50%, 100%': {
  					opacity: '0',
  					transform: 'scale(1)',
  					strokeWidth: '0'
  				}
  			},
  			'star-fill': {
  				'0%, 40%': {
  					transform: 'scale(0)'
  				},
  				'60%': {
  					transform: 'scale(1.2)'
  				},
  				'80%': {
  					transform: 'scale(0.9)'
  				},
  				'100%': {
  					transform: 'scale(1)'
  				}
  			},
  			'star-stroke': {
  				'0%': {
  					transform: 'scale(1)'
  				},
  				'20%, 100%': {
  					transform: 'scale(0)'
  				}
  			},
  			'star-line': {
  				'0%, 40%': {
  					strokeDasharray: '1 23',
  					strokeDashoffset: '1'
  				},
  				'60%, 100%': {
  					strokeDasharray: '12 13',
  					strokeDashoffset: '-13'
  				}
  			},
  			'clock-spin': {
  				'0%': {
  					transform: 'rotate(0deg)'
  				},
  				'100%': {
  					transform: 'rotate(360deg)'
  				}
  			},
  			'clock-tick': {
  				'0%': {
  					transform: 'rotate(0deg)'
  				},
  				'20%': {
  					transform: 'rotate(72deg)'
  				},
  				'40%': {
  					transform: 'rotate(144deg)'
  				},
  				'60%': {
  					transform: 'rotate(216deg)'
  				},
  				'80%': {
  					transform: 'rotate(288deg)'
  				},
  				'100%': {
  					transform: 'rotate(360deg)'
  				}
  			},
  			'gear-spin': {
  				'0%': {
  					transform: 'rotate(0deg)'
  				},
  				'100%': {
  					transform: 'rotate(180deg)'
  				}
  			}
  		},
  		backdropBlur: {
  			xs: '2px'
  		},
  		boxShadow: {
  			glass: '0 4px 30px rgba(0, 0, 0, 0.1)',
  			'glass-hover': '0 4px 30px rgba(0, 0, 0, 0.2)',
  			glow: '0 0 15px rgba(255, 255, 255, 0.1)',
  			'glow-hover': '0 0 20px rgba(255, 255, 255, 0.2)'
  		},
  		screens: {
  			xs: '475px'
  		},
  		transitionProperty: {
  			filter: 'filter'
  		},
  		zIndex: {
  			background: '-10',
  			elevated: '10',
  			navbar: '50',
  			dropdown: '100',
  			modal: '1000'
  		},
  		transitionTimingFunction: {
  			'bounce-start': 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  			'smooth-out': 'cubic-bezier(0.65, 0, 0.35, 1)'
  		},
  		spacing: {
  			'18': '4.5rem',
  			'72': '18rem',
  			'84': '21rem',
  			'96': '24rem'
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};