# Contributing to MAGAJI

Thank you for your interest in contributing to MAGAJI. This document provides guidelines for development and contribution.

## Getting Started

1. Clone the repository
2. Install dependencies: `npm ci`
3. Read README.md for architecture and conventions
4. Review the documentation in `docs/` for implementation guidelines

## Development Setup

```bash
git clone https://github.com/LasciaStare/MAGAJI.git
cd MAGAJI
npm ci
npm run tauri dev
```

## Code Standards

### TypeScript

- All code must pass `npm run build` (includes tsc strict mode)
- No `any` types without discussion
- All functions and data structures must be typed
- Use interfaces for component props and data models

### Components

- Functional components with hooks only
- Use Spanish domain variable names (producto, venta, cliente, etc.)
- Props must be properly typed with interfaces
- Extract reusable logic into utils or services

### Database

- Always use `getDbConnection()` from src/database/db.ts
- Wrap business errors with ErrorNegocio class
- Include comments for complex SQL queries
- Test schema changes with initDB() idempotency

### Error Handling

- Use ErrorNegocio for domain-specific errors
- Provide error code and user-friendly message
- Test error paths manually

### Styling

- Use Tailwind CSS classes with design tokens (pos-primary, pos-dark, etc.)
- Avoid inline styles
- Maintain consistency with existing component styling
- Do not modify design tokens without team discussion

## Commit Guidelines

Use semantic commit format:

```
feat: add barcode auto-generation for products without factory codes
fix: correct EAN-13 checksum calculation
docs: update barcode documentation with examples
refactor: extract database validation logic
chore: update dependencies
```

Commit messages should:
- Be clear and descriptive
- Reference features or bug fixes in the title
- Include detailed explanation if needed in the body
- Include any related issue numbers

Example:

```
feat: implement RCN barcode auto-generation

- Products without barcodes now receive auto-generated EAN-13 codes
- Prefix '20' ensures no collision with factory codes
- Implemented checksum validation per EAN-13 standard
- Added comprehensive documentation in docs/CODIGOS_BARRAS.md

Fixes #42
```

## Testing

Before submitting changes:

1. Run `npm run build` to ensure TypeScript compilation succeeds
2. Test the feature manually with `npm run tauri dev`
3. Verify database operations with fresh install (delete inventario.db)
4. Test error cases and edge conditions

For barcode testing:

```typescript
import { testEAN8Checksum, debugEAN8 } from '../utils/ean13-tests';
testEAN8Checksum();
```

## Documentation

Update documentation for:

- New features or significant changes
- Database schema modifications
- API changes or new exported functions
- User-facing workflows

Documentation files:

- README.md - User guide and project overview
- CONTRIBUTING.md - Contribution guidelines
- docs/CODIGOS_BARRAS.md - Barcode system details
- docs/OCR-DISTRIBUCION.md - OCR packaging and distribution
- docs/MODELOS-IA.md - AI model selection

## Pull Request Process

1. Create a feature branch: `git checkout -b feature/description`
2. Make focused, logical commits
3. Ensure `npm run build` passes
4. Test feature thoroughly
5. Update relevant documentation
6. Push to your branch
7. Create a pull request with clear description

PR title should follow semantic format: `feat:`, `fix:`, `docs:`, etc.

## Architecture Guidelines

### Component Organization

- Keep components small and focused
- Extract business logic into services or utils
- Use TypeScript interfaces for all data structures
- Pass data through props and callbacks, not globals

### Database Operations

- Keep database queries in src/database/db.ts
- Use services for business logic that involves multiple tables
- Implement proper error handling for all queries
- Log important operations for debugging

### State Management

- Use React hooks (useState, useContext, etc.)
- Lift state to common parent when needed
- Consider extracting complex state logic into custom hooks
- Avoid prop drilling with too many levels

## Performance Considerations

- Minimize database queries in render functions
- Use React.memo for expensive components if needed
- Lazy load large datasets
- Cache calculation results when appropriate
- Monitor bundle size via build output

## Accessibility

- Use semantic HTML elements
- Include proper ARIA labels where necessary
- Ensure keyboard navigation works
- Test with screen readers for critical features
- Maintain sufficient color contrast

## Security

- Never hardcode credentials or secrets
- Validate all user input on frontend and backend
- Use parameterized queries for all database operations
- Do not commit .env files or sensitive data
- Follow OWASP guidelines for web application security

## Questions or Issues

For questions or bug reports:

1. Check existing GitHub issues
2. Review README.md and CONTRIBUTING.md
3. Search documentation in the docs/ folder
4. Create a detailed GitHub issue if needed

## License

By contributing, you agree that your contributions are licensed under the same license as the project (see LICENSE file).
