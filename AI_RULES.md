# Tech Stack
- React 18 with TypeScript
- Vite as the build tool and development server
- React Router for client-side routing (routes kept in src/App.tsx)
- shadcn/ui component library for pre-built, accessible UI components
- Tailwind CSS for utility-first styling (apply classes directly in JSX)
- Lucide React for icons (import from lucide-react)
- Radix UI primitives (used under the hood by shadcn/ui)
- No additional state management library required; use React hooks (useState, useEffect, etc.)

# Usage Rules
- Place all source code inside the `src/` directory.
- Pages go in `src/pages/`; each page is a React component exported as default.
- Reusable UI components go in `src/components/`.
- The main landing page is `src/pages/Index.tsx`; always update this file to showcase new components.
- Keep all route definitions in `src/App.tsx`; do not scatter routing logic elsewhere.
- When building UI, prefer shadcn/ui components; customize them only by creating new wrapper components, never by editing the library files.
- Style exclusively with Tailwind CSS classes; avoid writing custom CSS or CSS-in-JS unless absolutely necessary.
- For icons, import from `lucide-react`; do not use external icon libraries.
- Follow React functional component conventions with TypeScript props interfaces.
- Ensure any new component is imported and used in `src/pages/Index.tsx` (or another appropriate page) so it appears in the preview.