import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { MODULE_IDS, DEFAULT_MODULES, ALL_MODULES, NO_MODULES, LEAN_MODULES } from '../src/module-config.js'
import { executionModeBlock, MODULE_CONTENT, moduleUsage } from '../src/prompt-modules.js'
import { ANCHORS, EXECUTION_MODE_BLOCK, fuseSections, fusedMinimalPrompt, contractAdditions } from '../src/rules.js'

const cases = [
  ['standard', 'standard'], ['standard-plan', 'standard'], ['ptc', 'ptc'],
  ['ptc-plan', 'ptc'], ['cordis', 'cordis'], ['cordis-plan', 'cordis'], ['subagent-standard', 'standard'],
]
const fixtures = await Promise.all(cases.map(async ([label, preset]) => ({
  label, preset, sections: JSON.parse(await readFile(new URL(`./fixtures/sections-${label}.json`, import.meta.url))),
})))
const fragments = id => Array.isArray(MODULE_CONTENT[id])
  ? MODULE_CONTENT[id].map(route => route.text) : [MODULE_CONTENT[id]]

test('compatibility defaults enable every module and preserve the original full contract', () => {
  assert.deepEqual(DEFAULT_MODULES, ALL_MODULES)
  assert.equal(executionModeBlock(), EXECUTION_MODE_BLOCK)
})

for (const id of MODULE_IDS) {
  test(`disabling ${id} removes its complete fragments in every applicable preset`, () => {
    const modules = { ...ALL_MODULES, [id]: false }
    const block = executionModeBlock(modules)
    assert.ok(block.length < EXECUTION_MODE_BLOCK.length)
    for (const fragment of fragments(id)) assert.ok(!block.includes(fragment))
    for (const other of MODULE_IDS.filter(other => other !== id)) {
      for (const fragment of fragments(other)) assert.ok(block.includes(fragment), `unexpected removal: ${other}`)
    }
    for (const { sections, preset, label } of fixtures) {
      const before = structuredClone(sections)
      const fused = fuseSections(sections, preset, { modules, isSubagent: label.startsWith('subagent') })
      assert.equal(fused.issues, undefined)
      assert.equal(fused.sections.find(s => s.name === 'unrestricted:execution-mode').text, block)
      assert.deepEqual(sections, before, 'original sections mutated')
      for (const section of before) {
        const next = fused.sections.find(s => s.name === section.name)
        assert.ok(next.text.startsWith(section.text), `native text lost in ${label}/${section.name}`)
      }
    }
    for (const fragment of fragments(id)) assert.ok(!fusedMinimalPrompt(modules).includes(fragment))
  })
}

test('every module can run alone without pulling in any other module body', () => {
  for (const id of MODULE_IDS) {
    const block = executionModeBlock({ ...NO_MODULES, [id]: true })
    for (const fragment of fragments(id)) assert.ok(block.includes(fragment))
    for (const other of MODULE_IDS.filter(other => other !== id)) {
      for (const fragment of fragments(other)) assert.ok(!block.includes(fragment))
    }
  }
})

test('all-off is a byte-identical pass-through, with no header, pointer or coordination notes', () => {
  assert.equal(executionModeBlock(NO_MODULES), '')
  assert.equal(fusedMinimalPrompt(NO_MODULES), ANCHORS.personaMinimal)
  for (const { sections, preset, label } of fixtures) {
    const result = fuseSections(sections, preset, { modules: NO_MODULES, isSubagent: label.startsWith('subagent') })
    assert.strictEqual(result.sections, sections)
    assert.equal(JSON.stringify(result.sections), JSON.stringify(sections))
    assert.ok(Object.values(contractAdditions(preset, NO_MODULES)).every(value => value === ''))
  }
})

test('coordination notes disappear with their switch while native plan and tool instructions survive', () => {
  const modules = { ...ALL_MODULES, runtimeCoordination: false }
  for (const { sections, preset } of fixtures) {
    const result = fuseSections(sections, preset, { modules, isSubagent: true })
    for (const name of ['plan:policy', 'tools:ptc-only', 'tool:structured_output']) {
      const original = sections.find(s => s.name === name)
      if (original) assert.equal(result.sections.find(s => s.name === name).text, original.text)
    }
  }
})

test('usage follows the selected body characters', () => {
  const rows = moduleUsage(LEAN_MODULES)
  assert.equal(rows.filter(row => row.enabled).length, 1)
  assert.equal(rows.find(row => row.id === 'delivery').characters, MODULE_CONTENT.delivery.length)
  assert.ok(executionModeBlock(LEAN_MODULES).length < EXECUTION_MODE_BLOCK.length * 0.2)
})
