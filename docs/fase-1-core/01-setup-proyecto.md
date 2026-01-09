# Setup del Proyecto

## Package.json

El proyecto usa ESM (ES Modules) con pnpm como package manager.

### Scripts Principales

```json
{
  "scripts": {
    "dev": "tsx watch src/app.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "format": "prettier --write \"src/**/*.ts\"",
    "format:check": "prettier --check \"src/**/*.ts\"",
    "test": "vitest run",
    "test:watch": "vitest",
    "worker": "tsx src/worker.ts"
  }
}
```

### Dependencias

**Producción:**
- `express@5.2.1` - Framework HTTP
- `redis@5.10.0` - Cliente Redis
- `@prisma/client@6.13.0` - ORM
- `zod@4.2.1` - Validación
- `pino@10.1.0` - Logging
- `pino-http@11.0.0` - HTTP logging
- `dotenv@17.2.3` - Variables de entorno

**Desarrollo:**
- `typescript@5.9.3` - Lenguaje
- `tsx@4.21.0` - Ejecutar TS directamente
- `eslint@9.39.2` - Linting
- `prettier@3.7.4` - Formateo
- `vitest@4.0.16` - Testing
- `typescript-eslint@8.51.0` - ESLint para TS

---

## TypeScript Configuration

**Archivo:** `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

### Decisiones de Diseño

| Opción | Valor | Por qué |
|--------|-------|---------|
| `target` | ES2022 | Soporte nativo de async/await, top-level await |
| `module` | NodeNext | ESM nativo en Node.js |
| `strict` | true | Máxima seguridad de tipos |
| `noUncheckedIndexedAccess` | true | Acceso a arrays/objects más seguro |
| `noUnusedLocals/Parameters` | true | Código limpio |

---

## ESLint Configuration

**Archivo:** `eslint.config.js`

```javascript
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', '*.config.js'],
  }
);
```

### Reglas Importantes

- **Variables no usadas**: Error, excepto las que empiezan con `_`
- **Type imports**: Obligatorio usar `import type` para tipos
- **Strict type checking**: Habilitado para máxima seguridad

---

## Prettier Configuration

**Archivo:** `.prettierrc`

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100,
  "bracketSpacing": true
}
```

---

## Vitest Configuration

**Archivo:** `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'dist/']
    }
  }
});
```
