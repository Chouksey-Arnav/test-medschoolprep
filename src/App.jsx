import React, { useState, useEffect, useRef, memo, useCallback } from 'react';
import katex from 'katex';

/* ═══════════════════════════════════════════
   LANDING PAGE URL  (used by signOut)
   Must match your Repo 1 Vercel deployment.
═══════════════════════════════════════════ */
const LANDING_URL = 'https://medschoolprep-landing.vercel.app';

/* ═══════════════════════════════════════════
   KATEX
═══════════════════════════════════════════ */
const renderMath = (latex) => {
  try { return katex.renderToString(latex, { throwOnError: false, displayMode: false }); }
  catch { return latex; }
};
const MixedText = memo(({ t }) => {
  if (!t) return null;
  return (
    <>{String(t).split(/(\$[^$]+\$)/g).map((p, i) =>
      (p[0] === '$' && p[p.length - 1] === '$')
        ? <span key={i} dangerouslySetInnerHTML={{ __html: renderMath(p.slice(1, -1)) }} />
        : <span key={i}>{p}</span>
    )}</>
  );
});
MixedText.displayName = 'MixedText';

/* ═══════════════════════════════════════════
   LOCALSTORAGE HELPER
   Named 'storage' to avoid shadowing with
   local 'ls' variables throughout the component.
═══════════════════════════════════════════ */
const storage = {
  get: (k, d = null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* ═══════════════════════════════════════════
   KHAN ACADEMY MASTERY SYSTEM
   
   Levels:  0=Not Started  1=Familiar  2=Proficient  3=Mastered
   Dots:    ○              ◐           ●             ★
   
   correctCount thresholds (cumulative across ALL sessions):
     1+  correct → Familiar
     5+  correct → Proficient
     10+ correct → Mastered
   
   Each practice session has 5 questions.
   Best case: 5 correct → still Familiar after session 1.
   Session 2 perfect: 10 correct → Mastered.
   This matches KA's multi-session mastery model.
═══════════════════════════════════════════ */
const MASTERY = {
  0: { label: 'Not Started', color: '#6b7280', bg: 'rgba(107,114,128,0.12)', border: 'rgba(107,114,128,0.28)', dot: '○' },
  1: { label: 'Familiar',    color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.32)',  dot: '◐' },
  2: { label: 'Proficient',  color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.32)',  dot: '●' },
  3: { label: 'Mastered',    color: '#10b981', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.32)',  dot: '★' },
};
const MASTERY_THRESHOLDS = [0, 1, 5, 10]; // min correctCount for each level
const getMasteryLevel  = (count) => count >= 10 ? 3 : count >= 5 ? 2 : count >= 1 ? 1 : 0;
const nextThreshold    = (level) => MASTERY_THRESHOLDS[Math.min(level + 1, 3)];
const progressToNext   = (count, level) => {
  if (level >= 3) return 100;
  const lo = MASTERY_THRESHOLDS[level], hi = MASTERY_THRESHOLDS[level + 1];
  return Math.min(100, Math.round(((count - lo) / (hi - lo)) * 100));
};

/* ═══════════════════════════════════════════
   PATHWAY STATE HELPERS
   
   BUG FIX: local variables renamed to 'lstate'
   (not 'ls') to avoid shadowing the module-level
   'storage' helper (previously named 'ls').
═══════════════════════════════════════════ */
const getLessonState = (pathway, unitId, lessonId) => {
  const unit = pathway[unitId] || {};
  if (unit.lessons && unit.lessons[lessonId]) return unit.lessons[lessonId];
  // Backward-compat: migrate from old lessonsComplete[] format
  if (Array.isArray(unit.lessonsComplete) && unit.lessonsComplete.includes(lessonId))
    return { videoWatched: true, articleRead: true, masteryLevel: 1, correctCount: 1, sessions: 1 };
  return { videoWatched: false, articleRead: false, masteryLevel: 0, correctCount: 0, sessions: 0 };
};

const setLessonState = (pathway, unitId, lessonId, updater) => {
  const unit = pathway[unitId] || { unlocked: false, masteryScore: null, lessons: {} };
  const cur  = getLessonState(pathway, unitId, lessonId);
  return {
    ...pathway,
    [unitId]: { ...unit, lessons: { ...(unit.lessons || {}), [lessonId]: updater(cur) } }
  };
};

// Unit mastery % = avg lesson mastery level / 3 (max)
const calcUnitMastery = (pathway, unit) => {
  if (!unit.lessons.length) return 0;
  const sum = unit.lessons.reduce(
    (s, l) => s + (getLessonState(pathway, unit.id, l.id).masteryLevel || 0), 0
  );
  return Math.round((sum / (unit.lessons.length * 3)) * 100);
};

// Course mastery % = avg of all unit mastery %
const calcCourseMastery = (pathway, path) => {
  if (!path) return 0;
  const pcts = path.units.map(u => calcUnitMastery(pathway, u));
  return pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0;
};

// Smart Continue: find the very next thing the student should do
const findNextItem = (pathway, path) => {
  if (!path) return null;
  for (const unit of path.units) {
    const us = pathway[unit.id] || {};
    if (!us.unlocked) continue;
    for (const lesson of unit.lessons) {
      const lstate = getLessonState(pathway, unit.id, lesson.id);
      if (!lstate.videoWatched)   return { unit, lesson, step: 'video' };
      if (!lstate.articleRead)    return { unit, lesson, step: 'article' };
      if (lstate.masteryLevel < 3) return { unit, lesson, step: 'practice' };
    }
    // All lessons done — suggest mastery check
    if (!us.masteryScore || us.masteryScore < unit.req) {
      const allAtLeastFamiliar = unit.lessons.every(
        l => getLessonState(pathway, unit.id, l.id).masteryLevel >= 1
      );
      if (allAtLeastFamiliar) return { unit, lesson: null, step: 'mastery' };
    }
  }
  return { step: 'complete' };
};

// Find lowest-mastery lessons for Personalized Practice
const findWeakestLessons = (pathway, path, limit = 6) => {
  if (!path) return [];
  const all = [];
  path.units.forEach(unit => {
    if (!pathway[unit.id]?.unlocked) return;
    unit.lessons.forEach(lesson => {
      const lstate = getLessonState(pathway, unit.id, lesson.id);
      if (lstate.masteryLevel < 3) {
        all.push({ unit, lesson, level: lstate.masteryLevel, count: lstate.correctCount || 0 });
      }
    });
  });
  return all.sort((a, b) => a.level - b.level || a.count - b.count).slice(0, limit);
};

const DIAGNOSTIC_QS = [
  { q: 'Which clinical scenario excites you most?', opts: ['Performing a complex surgical procedure', 'Solving a diagnostic mystery over weeks', 'Comforting a child and their family through illness', 'Exploring the human mind and behavior', 'Running a groundbreaking clinical trial'], w: { surgery: [5,1,1,1,1], internal: [1,5,1,1,2], pediatrics: [1,1,5,1,1], psychiatry: [1,1,2,5,1], research: [1,2,1,1,5] } },
  { q: 'Your ideal work environment is:', opts: ['Fast-paced OR with clear, immediate outcomes', 'Hospital ward with long-term patient relationships', 'Outpatient clinic focused on families', 'Private therapy or inpatient psychiatry unit', 'Lab, conference room, or academic setting'], w: { surgery: [5,1,1,1,1], internal: [1,5,1,1,2], pediatrics: [1,1,5,1,1], psychiatry: [1,1,1,5,1], research: [1,1,1,1,5] } },
  { q: 'Which subject energizes you most?', opts: ['Anatomy and biomechanics', 'Physiology and pharmacology', 'Pediatric development & growth', 'Psychology and social behavior', 'Biochemistry and molecular biology'], w: { surgery: [5,2,1,1,2], internal: [2,5,1,1,2], pediatrics: [1,2,5,1,1], psychiatry: [1,1,1,5,2], research: [2,2,1,2,5] } },
  { q: 'Your personality under pressure:', opts: ['Decisive, action-oriented, hands-on', 'Methodical, analytical, systematic', 'Empathetic, nurturing, patient-centered', 'Reflective, insightful, deep listener', 'Data-driven, evidence-based, rigorous'], w: { surgery: [5,2,1,1,1], internal: [2,5,1,1,2], pediatrics: [1,1,5,2,1], psychiatry: [1,2,2,5,1], research: [1,2,1,1,5] } },
  { q: 'Your strongest MCAT section:', opts: ['Chem/Phys', 'Bio/Biochem', 'CARS', 'Psych/Soc', 'All equal'], w: { surgery: [4,3,1,1,2], internal: [2,5,2,2,2], pediatrics: [2,3,3,3,2], psychiatry: [1,2,3,5,2], research: [3,5,2,2,2] } },
  { q: 'How do you prefer patient interaction?', opts: ['Brief, high-stakes procedural', 'Long-term relationship management', 'Family-centered, pediatric-focused', 'Deep psychological, therapeutic', 'Minimal contact — I prefer research'], w: { surgery: [5,1,1,1,1], internal: [1,5,1,1,1], pediatrics: [1,2,5,1,1], psychiatry: [1,1,1,5,1], research: [1,1,1,1,5] } },
  { q: 'Which best describes you?', opts: ['I love working with my hands', 'I love piecing together complex clinical puzzles', 'I love watching patients grow and heal over time', 'I love exploring what makes people think and feel', 'I love discovering knowledge that did not exist before'], w: { surgery: [5,2,1,1,1], internal: [1,5,1,1,2], pediatrics: [1,1,5,1,1], psychiatry: [1,1,2,5,1], research: [1,1,1,1,5] } },
  { q: 'Your dream research project:', opts: ['Surgical technique or device innovation', 'Disease pathophysiology and new drug targets', 'Pediatric vaccine or child health intervention', 'Mental health treatment outcomes', 'Genomics, proteomics, or molecular medicine'], w: { surgery: [5,2,1,1,1], internal: [1,5,1,1,2], pediatrics: [1,1,5,1,1], psychiatry: [1,1,1,5,1], research: [1,2,1,2,5] } },
  { q: 'Work-life integration for you means:', opts: ['Intense bursts with tangible payoffs', 'Intellectually demanding but predictable hours', 'Family-friendly hours that matter deeply', 'Flexible scheduling for therapy sessions', 'Academic schedule with protected research time'], w: { surgery: [5,2,1,1,1], internal: [1,5,1,1,1], pediatrics: [1,1,5,1,1], psychiatry: [1,1,2,5,1], research: [1,1,1,1,5] } },
  { q: 'Which physician inspires you most?', opts: ['Atul Gawande (Surgery & Safety)', 'Paul Kalanithi (Neurology & Literature)', 'Benjamin Spock (Pediatrics & Family)', 'Victor Frankl (Psychiatry & Meaning)', 'Francis Collins (Genomics & Leadership)'], w: { surgery: [5,2,1,1,1], internal: [2,5,1,1,2], pediatrics: [1,1,5,1,1], psychiatry: [1,1,1,5,1], research: [1,2,1,1,5] } },
];

/* ═══════════════════════════════════════════════════════════════════
   SPECIALTY PATHS — full Khan Academy structure
   Each unit: id, title, desc, cat, req, masteryTotal, xp, lessons[]
   Each lesson: id, title, url (Khan), yt (YouTube), dur, note
═══════════════════════════════════════════════════════════════════ */
const PATHS = {
  surgery: {
    label: 'General Surgery', icon: '\ud83d\udd2c', accent: '#ef4444', border: 'border-red-500/40',
    tagline: 'Master anatomy, physiology & surgical science',
    units: [
      { id: 'su1', title: 'Biochemistry Foundations', desc: 'Amino acids, enzymes, metabolism', cat: 'Bio/Biochem', req: 3, masteryTotal: 4, xp: 150,
        lessons: [
          { id: 'su1-l1', title: 'Amino Acid Structure & Properties', url: 'https://www.khanacademy.org/test-prep/mcat/biomolecules', yt: 'https://www.youtube.com/watch?v=Eq1xMEGTnVE', dur: '18 min', note: 'Know pKa: Asp/Glu (acidic), Lys/Arg/His (basic) — determines charge at physiological pH.' },
          { id: 'su1-l2', title: 'Enzyme Kinetics & Inhibition', url: 'https://www.khanacademy.org/test-prep/mcat/biomolecules', yt: 'https://www.youtube.com/watch?v=4SjNWBJkASU', dur: '22 min', note: 'Lineweaver-Burk: competitive raises Km (x-intercept shifts left), non-competitive lowers Vmax (y-intercept rises).' },
          { id: 'su1-l3', title: 'Glycolysis & the TCA Cycle', url: 'https://www.khanacademy.org/test-prep/mcat/biomolecules', yt: 'https://www.youtube.com/watch?v=2f7YwCtHcgk', dur: '25 min', note: 'Net: 2 ATP from glycolysis; ~30 ATP from full oxidation via oxidative phosphorylation.' },
        ]
      },
      { id: 'su2', title: 'Cardiovascular & Respiratory', desc: 'Heart, lungs, hemodynamics', cat: 'Chem/Phys', req: 3, masteryTotal: 4, xp: 175,
        lessons: [
          { id: 'su2-l1', title: 'Cardiac Cycle & Hemodynamics', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=AXTzYYCl3bk', dur: '20 min', note: 'Frank-Starling: increased preload increases sarcomere stretch, which increases stroke volume.' },
          { id: 'su2-l2', title: 'Respiratory Mechanics & Gas Exchange', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=HPHByM4ANLI', dur: '18 min', note: 'V/Q = 0 (shunt: perfused, not ventilated). V/Q = infinity (dead space: ventilated, not perfused).' },
          { id: 'su2-l3', title: 'Acid-Base Disorders', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=0YbBMPah3y0', dur: '15 min', note: 'ROME mnemonic: Respiratory Opposite, Metabolic Equal. Normal ABG: pH 7.35-7.45, PCO2 35-45, HCO3 22-26.' },
        ]
      },
      { id: 'su3', title: 'Musculoskeletal System', desc: 'Bones, muscles, connective tissue', cat: 'Bio/Biochem', req: 3, masteryTotal: 4, xp: 175,
        lessons: [
          { id: 'su3-l1', title: 'Sliding Filament & Muscle Contraction', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=GrHsiHazpsw', dur: '20 min', note: 'Ca2+ binds troponin-C, tropomyosin shifts, exposes actin binding sites, myosin power stroke occurs.' },
          { id: 'su3-l2', title: 'Bone Remodeling & Mineral Homeostasis', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=wJ_GGMx-GCk', dur: '17 min', note: 'PTH raises serum Ca2+ (activates osteoclasts, renal Ca2+ reabsorption, stimulates calcitriol production).' },
          { id: 'su3-l3', title: 'Collagen & Connective Tissue', url: 'https://www.khanacademy.org/test-prep/mcat/biomolecules', yt: 'https://www.youtube.com/watch?v=Ck7RqJiHcNk', dur: '15 min', note: 'Type I: bone/tendon. Type II: cartilage. Type IV: basement membrane. Vitamin C required for hydroxylation.' },
        ]
      },
      { id: 'su4', title: 'Molecular Biology & Genetics', desc: 'DNA, RNA, gene regulation', cat: 'Bio/Biochem', req: 3, masteryTotal: 4, xp: 200,
        lessons: [
          { id: 'su4-l1', title: 'DNA Replication & Repair', url: 'https://www.khanacademy.org/test-prep/mcat/biomolecules', yt: 'https://www.youtube.com/watch?v=TNKWgcFPHqw', dur: '20 min', note: 'Leading strand: continuous 5\u2019\u21923\u2019. Lagging strand: Okazaki fragments joined by ligase.' },
          { id: 'su4-l2', title: 'Transcription, Translation & PTMs', url: 'https://www.khanacademy.org/test-prep/mcat/biomolecules', yt: 'https://www.youtube.com/watch?v=WkI_Vbwn14g', dur: '18 min', note: 'RNA Pol II makes mRNA; 5\u2019 cap + poly-A tail added; introns removed by spliceosome.' },
          { id: 'su4-l3', title: 'Mendelian Genetics & Pedigree Analysis', url: 'https://www.khanacademy.org/test-prep/mcat/biomolecules', yt: 'https://www.youtube.com/watch?v=kMKho3d1_0w', dur: '22 min', note: 'Hardy-Weinberg: p2 + 2pq + q2 = 1. Assumes no mutation, migration, selection, drift, random mating.' },
        ]
      },
      { id: 'su5', title: 'Physics & Fluid Dynamics', desc: 'Mechanics, fluids, thermodynamics', cat: 'Chem/Phys', req: 3, masteryTotal: 4, xp: 200,
        lessons: [
          { id: 'su5-l1', title: "Poiseuille's Law & Fluid Mechanics", url: 'https://www.khanacademy.org/test-prep/mcat/physical-processes', yt: 'https://www.youtube.com/watch?v=4TqDhZ9LDSQ', dur: '18 min', note: 'Q proportional to r4: halving radius reduces flow 16-fold. Radius is the most powerful variable.' },
          { id: 'su5-l2', title: 'Circuits & Electricity', url: 'https://www.khanacademy.org/test-prep/mcat/physical-processes', yt: 'https://www.youtube.com/watch?v=ZrMw7P6P2Cs', dur: '20 min', note: 'Series: resistances add, same current. Parallel: 1/R_total = sum(1/Rn), same voltage.' },
          { id: 'su5-l3', title: 'Thermodynamics & Free Energy', url: 'https://www.khanacademy.org/test-prep/mcat/physical-processes', yt: 'https://www.youtube.com/watch?v=CFmzT1lAdcA', dur: '22 min', note: 'deltaG = deltaH - T*deltaS. Spontaneous when deltaG < 0. Enzymes lower Ea only, never change deltaG.' },
        ]
      },
    ]
  },
  internal: {
    label: 'Internal Medicine', icon: '\ud83e\ude7a', accent: '#3b82f6', border: 'border-blue-500/40',
    tagline: 'Master diagnostic reasoning & pharmacology',
    units: [
      { id: 'im1', title: 'Pathophysiology Foundations', desc: 'Disease at the cellular level', cat: 'Bio/Biochem', req: 3, masteryTotal: 4, xp: 150,
        lessons: [
          { id: 'im1-l1', title: 'Inflammation & Immune Response', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=kz9LFvRBLXA', dur: '20 min', note: 'COX-2 produces prostaglandins. NSAIDs block COX non-selectively; celecoxib is COX-2 selective.' },
          { id: 'im1-l2', title: 'Necrosis vs Apoptosis', url: 'https://www.khanacademy.org/test-prep/mcat/biomolecules', yt: 'https://www.youtube.com/watch?v=9KIH42V6A3M', dur: '18 min', note: 'Apoptosis: caspase cascade, cell shrinks, no inflammation. Necrosis: uncontrolled, cell swells, triggers inflammation.' },
          { id: 'im1-l3', title: 'Neoplasia & Cancer Biology', url: 'https://www.khanacademy.org/test-prep/mcat/biomolecules', yt: 'https://www.youtube.com/watch?v=RZhL7LDPk8w', dur: '22 min', note: 'Proto-oncogenes = gas pedal (gain-of-function). Tumor suppressors = brakes (2-hit hypothesis: lose both alleles).' },
        ]
      },
      { id: 'im2', title: 'Pharmacology Principles', desc: 'PK/PD, CYP450, drug interactions', cat: 'Bio/Biochem', req: 3, masteryTotal: 4, xp: 175,
        lessons: [
          { id: 'im2-l1', title: 'Drug Absorption & Bioavailability', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=CUXJqHB_6Os', dur: '18 min', note: 'First-pass hepatic metabolism reduces oral bioavailability. IV = 100% (bypasses GI tract and liver).' },
          { id: 'im2-l2', title: 'Receptor Pharmacology', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=9miR3Xv_1mI', dur: '20 min', note: 'ED50 = dose for 50% maximal effect (potency). Therapeutic index = LD50/ED50. Narrow TI needs monitoring.' },
          { id: 'im2-l3', title: 'Drug Metabolism & CYP450', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=6-w4x1wz9oQ', dur: '15 min', note: 'CYP3A4 metabolizes ~50% of drugs. Inducers (rifampin) increase clearance; inhibitors (ketoconazole) increase drug levels.' },
        ]
      },
      { id: 'im3', title: 'Endocrinology', desc: 'Hormones, axes, diabetes', cat: 'Bio/Biochem', req: 3, masteryTotal: 4, xp: 175,
        lessons: [
          { id: 'im3-l1', title: 'Hypothalamic-Pituitary Axis', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=dJ79hHgOLxE', dur: '22 min', note: 'Negative feedback: cortisol suppresses CRH (hypothalamus) and ACTH (pituitary). Disrupted in Cushing syndrome.' },
          { id: 'im3-l2', title: 'Thyroid & Adrenal Physiology', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=L5ESTrH7V7s', dur: '20 min', note: 'T3 is active form; T4 is prohormone. Adrenal cortex layers GFR: Glomerulosa (salt), Fasciculata (sugar), Reticularis (sex).' },
          { id: 'im3-l3', title: 'Diabetes Mellitus & Insulin Signaling', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=X9ivR4-eFmA', dur: '18 min', note: 'Type 1: autoimmune beta-cell destruction, absolute insulin deficiency. Type 2: insulin resistance.' },
        ]
      },
      { id: 'im4', title: 'Electrochemistry & Solutions', desc: 'Galvanic cells, buffers, osmolarity', cat: 'Chem/Phys', req: 3, masteryTotal: 4, xp: 175,
        lessons: [
          { id: 'im4-l1', title: 'Galvanic Cells & Nernst Equation', url: 'https://www.khanacademy.org/test-prep/mcat/physical-processes', yt: 'https://www.youtube.com/watch?v=lQ6FBA1HM3s', dur: '20 min', note: 'Nernst: E = Eo - (RT/nF)lnQ. Cathode = reduction, anode = oxidation. OILRIG mnemonic.' },
          { id: 'im4-l2', title: 'Acid-Base Equilibria & Buffers', url: 'https://www.khanacademy.org/test-prep/mcat/physical-processes', yt: 'https://www.youtube.com/watch?v=VZqCH7SVRGQ', dur: '18 min', note: 'Henderson-Hasselbalch: pH = pKa + log([A-]/[HA]). Best buffer when pH = pKa +/- 1.' },
          { id: 'im4-l3', title: 'Osmolarity & Colligative Properties', url: 'https://www.khanacademy.org/test-prep/mcat/physical-processes', yt: 'https://www.youtube.com/watch?v=hVMzGK8mfRk', dur: '15 min', note: 'Osmotic pressure pi = iMRT. Isotonic: no net water movement. Hypertonic: cell crenates. Hypotonic: cell lyses.' },
        ]
      },
      { id: 'im5', title: 'Behavioral Science & Sociology', desc: 'Biopsychosocial model, learning, attribution', cat: 'Psych/Soc', req: 3, masteryTotal: 4, xp: 200,
        lessons: [
          { id: 'im5-l1', title: 'Learning, Memory & Conditioning', url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=mB-6dn9cTJA', dur: '18 min', note: 'Classical: CS+US=CR. Operant: reinforcement increases behavior, punishment decreases. Variable-ratio most extinction-resistant.' },
          { id: 'im5-l2', title: 'Social Cognition & Attribution', url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=8MHMDqSbPDI', dur: '20 min', note: 'Fundamental Attribution Error: overestimate dispositional, underestimate situational factors in others\u2019 behavior.' },
          { id: 'im5-l3', title: 'Health Disparities & Social Determinants', url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=Hs1aFSH0cxo', dur: '15 min', note: 'Social determinants: income, education, housing, food security. SES inversely correlated with morbidity and mortality.' },
        ]
      },
    ]
  },
  pediatrics: {
    label: 'Pediatrics', icon: '\ud83d\udc76', accent: '#10b981', border: 'border-emerald-500/40',
    tagline: 'Specialize in child development & family medicine',
    units: [
      { id: 'pe1', title: 'Developmental Biology', desc: 'Embryology & milestones', cat: 'Bio/Biochem', req: 3, masteryTotal: 4, xp: 150,
        lessons: [
          { id: 'pe1-l1', title: 'Embryonic Development & Organogenesis', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=dAOWQDOX35k', dur: '22 min', note: 'Weeks 3-8 = organogenesis = highest teratogen risk. Thalidomide: limbs, alcohol: FAS, rubella: cardiac.' },
          { id: 'pe1-l2', title: 'Developmental Milestones by Age', url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=VDNgKtC_GRc', dur: '18 min', note: 'Social smile 2 mo, pincer grasp 9 mo, walks 12 mo, 2-word phrases 24 mo, sentences 36 mo.' },
          { id: 'pe1-l3', title: 'Chromosomal & Genetic Disorders', url: 'https://www.khanacademy.org/test-prep/mcat/biomolecules', yt: 'https://www.youtube.com/watch?v=IpBEae19Qlo', dur: '20 min', note: 'Down (T21): AV canal defects. Turner (45,X): webbed neck, primary amenorrhea. Klinefelter (47,XXY): infertility.' },
        ]
      },
      { id: 'pe2', title: 'Immunology & Infectious Disease', desc: 'Immunity, vaccines, infections', cat: 'Bio/Biochem', req: 3, masteryTotal: 4, xp: 175,
        lessons: [
          { id: 'pe2-l1', title: 'Innate vs Adaptive Immunity', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=LmpuerlbJu0', dur: '22 min', note: 'MHC I (all nucleated cells) presents to CD8+ T cells. MHC II (APCs) presents to CD4+ T cells.' },
          { id: 'pe2-l2', title: 'Vaccine Immunology', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=rb7TVW77ZCs', dur: '18 min', note: 'Live-attenuated (MMR): strongest, contraindicated immunocompromised. Inactivated: safer, may need boosters.' },
          { id: 'pe2-l3', title: 'Pediatric Infections Overview', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=VXRLgqBjr9E', dur: '15 min', note: 'Kawasaki: fever 5+ days + CRASH criteria. RSV = most common infant bronchiolitis. Croup: barking cough, steeple sign.' },
        ]
      },
      { id: 'pe3', title: 'Child Psychology', desc: 'Piaget, Erikson, attachment theory', cat: 'Psych/Soc', req: 3, masteryTotal: 4, xp: 175,
        lessons: [
          { id: 'pe3-l1', title: "Piaget's Cognitive Development", url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=TRF27F2bn-A', dur: '20 min', note: 'Sensorimotor (0-2): object permanence. Preoperational (2-7): egocentrism. Concrete (7-11): conservation. Formal (12+): abstract.' },
          { id: 'pe3-l2', title: 'Attachment Theory', url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=yrB5kSXE_uQ', dur: '18 min', note: 'Secure (60-65%): safe base exploration. Anxious-ambivalent: hard to soothe. Avoidant: ignores caregiver at reunion.' },
          { id: 'pe3-l3', title: "Erikson's Psychosocial Stages", url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=OhBME54N0hI', dur: '15 min', note: 'Eight stages birth to late adulthood. Key MCAT: Identity vs Role Confusion (adolescence). Each produces a virtue if resolved.' },
        ]
      },
      { id: 'pe4', title: 'Nutrition & Metabolism', desc: 'Vitamins, lipoproteins, nitrogen metabolism', cat: 'Bio/Biochem', req: 3, masteryTotal: 4, xp: 175,
        lessons: [
          { id: 'pe4-l1', title: 'Vitamins & Cofactors', url: 'https://www.khanacademy.org/test-prep/mcat/biomolecules', yt: 'https://www.youtube.com/watch?v=K0-BFzqBsJ8', dur: '20 min', note: 'Fat-soluble ADEK: stored, toxic in excess. B1 (TPP, PDH), B3 (NAD+), B12 (intrinsic factor, subacute combined).' },
          { id: 'pe4-l2', title: 'Lipid Metabolism & Lipoproteins', url: 'https://www.khanacademy.org/test-prep/mcat/biomolecules', yt: 'https://www.youtube.com/watch?v=n5QoSHmOubc', dur: '18 min', note: 'Chylomicrons: dietary fat via lymphatics. LDL: delivers cholesterol to tissues. HDL: reverse cholesterol transport.' },
          { id: 'pe4-l3', title: 'Urea Cycle & Nitrogen Metabolism', url: 'https://www.khanacademy.org/test-prep/mcat/biomolecules', yt: 'https://www.youtube.com/watch?v=i-5cSNWrK6E', dur: '15 min', note: 'Liver converts NH3 to urea. OTC deficiency (X-linked, most common urea cycle disorder): hyperammonemia.' },
        ]
      },
      { id: 'pe5', title: 'Research Methods & Statistics', desc: 'Study design, biostats, ethics', cat: 'Psych/Soc', req: 3, masteryTotal: 4, xp: 200,
        lessons: [
          { id: 'pe5-l1', title: 'Epidemiology & Study Design', url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=OqEbX6FSEQA', dur: '18 min', note: 'RCT = gold standard for causation. Cohort (prospective) calculates RR. Case-control (retrospective) calculates OR.' },
          { id: 'pe5-l2', title: 'Biostatistics for the MCAT', url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=U3M5-meSBKA', dur: '20 min', note: 'SnNout: high Sensitivity rules out disease. SpPin: high Specificity rules in disease. PPV increases with prevalence.' },
          { id: 'pe5-l3', title: 'Ethical Principles in Research', url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=X88jFfPvn00', dur: '15 min', note: 'Belmont Report: Respect for persons, Beneficence, Justice. Tuskegee (1932-72) led to National Research Act.' },
        ]
      },
    ]
  },
  psychiatry: {
    label: 'Psychiatry', icon: '\ud83e\udde0', accent: '#8b5cf6', border: 'border-violet-500/40',
    tagline: 'Master psychology, neuroscience & behavioral medicine',
    units: [
      { id: 'ps1', title: 'Neuroscience Foundations', desc: 'Neurons, synapses, brain regions', cat: 'Bio/Biochem', req: 3, masteryTotal: 4, xp: 150,
        lessons: [
          { id: 'ps1-l1', title: 'Neuron Structure & Action Potential', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=HYLyhXRp298', dur: '22 min', note: 'Resting: -70mV. Depolarization: Na+ in. Repolarization: K+ out. Refractory period prevents back-propagation.' },
          { id: 'ps1-l2', title: 'Synaptic Transmission & Neurotransmitters', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=WhowH0kb7n0', dur: '20 min', note: 'Dopamine: reward. Serotonin: mood. GABA: inhibitory (Cl- channel). Glutamate: excitatory (AMPA/NMDA receptors).' },
          { id: 'ps1-l3', title: 'Brain Regions & Their Functions', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=SRInEgxs2Pk', dur: '18 min', note: 'Amygdala: fear/emotion. Hippocampus: memory consolidation. PFC: executive function. Basal ganglia: movement control.' },
        ]
      },
      { id: 'ps2', title: 'Psychology & Behavior', desc: 'Learning, cognition, disorders', cat: 'Psych/Soc', req: 3, masteryTotal: 4, xp: 175,
        lessons: [
          { id: 'ps2-l1', title: 'Sensation, Perception & Consciousness', url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=unWnZvXJH2o', dur: '20 min', note: "Weber's Law: JND is a constant fraction of the original stimulus (deltaI/I = k)." },
          { id: 'ps2-l2', title: 'Motivation, Emotion & Stress', url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=bZEiJz3k5DY', dur: '18 min', note: "James-Lange: physiological arousal PRECEDES emotion. Schachter-Singer: arousal + cognitive label = emotion." },
          { id: 'ps2-l3', title: 'Psychological Disorders & DSM-5', url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=FHrfGiAb1ig', dur: '22 min', note: 'Schizophrenia: positive (hallucinations, delusions) + negative symptoms (flat affect, alogia, avolition, anhedonia).' },
        ]
      },
      { id: 'ps3', title: 'Social Science & Sociology', desc: 'Stratification, culture, group dynamics', cat: 'Psych/Soc', req: 3, masteryTotal: 4, xp: 175,
        lessons: [
          { id: 'ps3-l1', title: 'Social Stratification & Health Inequity', url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=7hTB1-4qM70', dur: '18 min', note: 'SES gradient: poverty causes higher chronic disease, mental illness, and infant mortality rates.' },
          { id: 'ps3-l2', title: 'Culture, Identity & Health Behavior', url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=FSJZ3mcC_p8', dur: '16 min', note: 'Acculturation: adapting to a new culture (assimilation, integration, separation, marginalization). Race is a social construct.' },
          { id: 'ps3-l3', title: 'Social Networks & Group Dynamics', url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=UGxGDdQnC1Y', dur: '15 min', note: 'Asch: 76% conformed at least once. Milgram: 65% applied max shock. Bystander effect: diffusion of responsibility.' },
        ]
      },
      { id: 'ps4', title: 'Neuropharmacology', desc: 'Psychiatric drugs & mechanisms', cat: 'Bio/Biochem', req: 3, masteryTotal: 4, xp: 175,
        lessons: [
          { id: 'ps4-l1', title: 'Antidepressants & Antipsychotics', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=YgnTKZnBXOM', dur: '22 min', note: 'SSRIs block SERT, raise synaptic serotonin (first-line). Atypicals: D2 + 5-HT2A block, fewer EPS than typicals.' },
          { id: 'ps4-l2', title: 'Anxiolytics & Mood Stabilizers', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=3Qp4DHWGZCA', dur: '18 min', note: 'Benzodiazepines: potentiate GABA-A (Cl- channel frequency). Lithium: gold standard for bipolar, narrow TI.' },
          { id: 'ps4-l3', title: 'Neuroplasticity & Memory', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=OyK9T4nBD9g', dur: '20 min', note: 'LTP: NMDA receptor Ca2+ influx causes AMPA receptor insertion and lasting synapse strengthening.' },
        ]
      },
      { id: 'ps5', title: 'Behavioral Research Methods', desc: 'Research design, stats, ethics', cat: 'Psych/Soc', req: 3, masteryTotal: 4, xp: 200,
        lessons: [
          { id: 'ps5-l1', title: 'Psychological Research Methodology', url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=9GCM1TerXck', dur: '18 min', note: 'Internal validity: study measures what it claims. External validity: results generalize. Confounders threaten internal validity.' },
          { id: 'ps5-l2', title: 'Statistics for Psych/Soc', url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=MXaJ7sa7q-8', dur: '22 min', note: 'Normal distribution: mean=median=mode. Positive skew: mean pulled toward tail. 68-95-99.7 rule for SD.' },
          { id: 'ps5-l3', title: 'Ethics in Behavioral Research', url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=cRGMv_MVKGQ', dur: '15 min', note: 'Tuskegee (1932-72) led to Belmont Report. Milgram and Zimbardo set APA ethics standards for debriefing and right to withdraw.' },
        ]
      },
    ]
  },
  research: {
    label: 'Research & Academia', icon: '\ud83d\udd2d', accent: '#f59e0b', border: 'border-amber-500/40',
    tagline: 'Excel in biomedical research & academic medicine',
    units: [
      { id: 're1', title: 'Molecular Biology', desc: 'Gene expression, epigenetics, CRISPR', cat: 'Bio/Biochem', req: 3, masteryTotal: 4, xp: 150,
        lessons: [
          { id: 're1-l1', title: 'Gene Expression & Epigenetic Regulation', url: 'https://www.khanacademy.org/test-prep/mcat/biomolecules', yt: 'https://www.youtube.com/watch?v=TfYf_rPWUdY', dur: '22 min', note: 'Methylation silences genes. Acetylation opens chromatin for transcription. Epigenetics: heritable without DNA changes.' },
          { id: 're1-l2', title: 'Protein Folding, Chaperones & Proteomics', url: 'https://www.khanacademy.org/test-prep/mcat/biomolecules', yt: 'https://www.youtube.com/watch?v=gFcp2Xpd29I', dur: '18 min', note: 'Hsp70 chaperones prevent misfolding. Prion diseases: misfolded PrPsc recruits normal PrPc (CJD, kuru, scrapie).' },
          { id: 're1-l3', title: 'CRISPR-Cas9 & Gene Editing', url: 'https://www.khanacademy.org/test-prep/mcat/biomolecules', yt: 'https://www.youtube.com/watch?v=2pp17E4E-O8', dur: '20 min', note: 'gRNA directs Cas9 to PAM (NGG) site. DSB repaired by NHEJ (error-prone, knockout) or HDR (precise, template needed).' },
        ]
      },
      { id: 're2', title: 'Epidemiology & Biostatistics', desc: 'Study design, bias, meta-analysis', cat: 'Psych/Soc', req: 3, masteryTotal: 4, xp: 175,
        lessons: [
          { id: 're2-l1', title: 'Epidemiology: Incidence, Prevalence, Risk', url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=OqEbX6FSEQA', dur: '20 min', note: 'RR from cohort; OR from case-control (approximates RR when disease rare). Attributable risk = exposed risk minus unexposed.' },
          { id: 're2-l2', title: 'Statistical Power, Error, Significance', url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=7nh3X_8c2cY', dur: '18 min', note: 'Type I (alpha): false positive. Type II (beta): false negative. Power = 1-beta. Larger n increases power.' },
          { id: 're2-l3', title: 'Systematic Reviews & Meta-Analysis', url: 'https://www.khanacademy.org/test-prep/mcat/behavior', yt: 'https://www.youtube.com/watch?v=SAE-mJXwnPE', dur: '15 min', note: 'Forest plot: diamond = pooled estimate. CI crossing 1.0 = not significant. Funnel asymmetry = publication bias.' },
        ]
      },
      { id: 're3', title: 'Physical Chemistry & Spectroscopy', desc: 'Lab techniques and physical chemistry', cat: 'Chem/Phys', req: 3, masteryTotal: 4, xp: 175,
        lessons: [
          { id: 're3-l1', title: 'Spectroscopy: NMR, IR & Mass Spec', url: 'https://www.khanacademy.org/test-prep/mcat/physical-processes', yt: 'https://www.youtube.com/watch?v=SBir5wUS3Bo', dur: '20 min', note: 'IR: 1700 cm-1 = carbonyl. NMR: n+1 splitting rule, ppm = deshielding. MS: M+ peak = molecular weight.' },
          { id: 're3-l2', title: 'Chromatography & Electrophoresis', url: 'https://www.khanacademy.org/test-prep/mcat/physical-processes', yt: 'https://www.youtube.com/watch?v=1bFzMPJNHmw', dur: '18 min', note: 'SDS-PAGE separates by size (smaller migrates further). Native PAGE by charge+size. TLC: less polar = higher Rf.' },
          { id: 're3-l3', title: 'Thermodynamics & Reaction Kinetics', url: 'https://www.khanacademy.org/test-prep/mcat/physical-processes', yt: 'https://www.youtube.com/watch?v=CFmzT1lAdcA', dur: '22 min', note: 'Arrhenius: k = Ae^(-Ea/RT). Catalysts lower Ea, do NOT change deltaG, deltaH, deltaS, or equilibrium K.' },
        ]
      },
      { id: 're4', title: 'Immunology & Virology', desc: 'Host-pathogen interactions in depth', cat: 'Bio/Biochem', req: 3, masteryTotal: 4, xp: 175,
        lessons: [
          { id: 're4-l1', title: 'Adaptive Immunity & V(D)J Recombination', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=mwnVcFWoxps', dur: '22 min', note: 'V(D)J recombination creates antibody diversity. Somatic hypermutation in germinal centers = affinity maturation.' },
          { id: 're4-l2', title: 'Microbial Pathogenesis & Virulence', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=VXRLgqBjr9E', dur: '20 min', note: 'A-B toxins: A=active, B=binding. Endotoxins (LPS) from gram-negative membrane trigger septic shock via TLR4.' },
          { id: 're4-l3', title: 'Viral Replication & Antiviral Targets', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', yt: 'https://www.youtube.com/watch?v=0h5Jd7sgQWY', dur: '18 min', note: 'HIV: RNA to DNA via reverse transcriptase, integrates. NRTIs/NNRTIs target RT. Lytic vs lysogenic cycle.' },
        ]
      },
      { id: 're5', title: 'Organic Chemistry', desc: 'Reactions, mechanisms, stereochemistry', cat: 'Chem/Phys', req: 3, masteryTotal: 4, xp: 200,
        lessons: [
          { id: 're5-l1', title: 'Nucleophilic Substitution (SN1 & SN2)', url: 'https://www.khanacademy.org/test-prep/mcat/physical-processes', yt: 'https://www.youtube.com/watch?v=MqnVGNr3mso', dur: '22 min', note: 'SN2: backside attack = Walden inversion, primary substrates, polar aprotic solvents. SN1: carbocation, tertiary, racemization.' },
          { id: 're5-l2', title: 'Carbonyl Chemistry & Reactions', url: 'https://www.khanacademy.org/test-prep/mcat/physical-processes', yt: 'https://www.youtube.com/watch?v=j9MikXByeys', dur: '20 min', note: 'Carbonyl C is electrophilic. Aldehydes > ketones in reactivity. Aldol condensation forms beta-hydroxy carbonyl.' },
          { id: 're5-l3', title: 'Stereochemistry & Chirality', url: 'https://www.khanacademy.org/test-prep/mcat/physical-processes', yt: 'https://www.youtube.com/watch?v=H8Z-VWq7DkI', dur: '18 min', note: 'R/S via Cahn-Ingold-Prelog: rank by atomic number, clockwise = R. Enantiomers rotate light equally but opposite directions.' },
        ]
      },
    ]
  },
};

/* ═══════════════════════════════════════════════════════════════════
   ARTICLE KEY POINTS — 4 high-yield bullets per lesson (KA-style)
═══════════════════════════════════════════════════════════════════ */
const LESSON_POINTS = {
  'su1-l1': ['All amino acids: central alpha-carbon with NH2, COOH, H, and unique R-group. At pH 7.4 they exist as zwitterions.','Essential AAs (cannot synthesize): PVT TIM HaLL — Phe, Val, Thr, Trp, Ile, Met, His, Arg, Leu, Lys.','Asp and Glu are acidic (negative at pH 7.4); Lys, Arg, His are basic (positive at pH 7.4).','Isoelectric point (pI): pH where net charge = 0. Protein precipitates and migrates least in electrophoresis at pI.'],
  'su1-l2': ['Km = substrate concentration at half-Vmax. LOW Km = HIGH affinity (enzyme grabs substrate easily).','Competitive inhibitor: increases apparent Km (can be overcome by excess substrate), Vmax unchanged.','Non-competitive inhibitor: decreases Vmax (cannot be overcome), Km unchanged. Binds allosteric site.','Lineweaver-Burk plot: y-intercept = 1/Vmax, x-intercept = -1/Km. Competitive: lines meet on y-axis.'],
  'su1-l3': ['Glycolysis (cytoplasm): 1 glucose → 2 pyruvate + 2 ATP net + 2 NADH. Rate-limiting enzyme: PFK-1 (inhibited by ATP and citrate).','Pyruvate dehydrogenase (mitochondrial matrix): pyruvate → acetyl-CoA. Requires TPP, lipoate, CoA, FAD, NAD+.','TCA cycle: 2 turns per glucose → 6 NADH + 2 FADH2 + 2 GTP. Rate-limiting: isocitrate dehydrogenase.','Total aerobic ATP from 1 glucose: approximately 30-32 ATP via NADH and FADH2 through oxidative phosphorylation.'],
  'su2-l1': ['Cardiac output = heart rate × stroke volume. Normal CO = ~5 L/min at rest. Can rise to ~25 L/min with exercise.','Frank-Starling law: increased EDV (preload) → increased sarcomere stretch → increased force of contraction → increased SV.','MAP (mean arterial pressure) = CO × TPR (total peripheral resistance). Normal MAP = ~93 mmHg.','S1 (AV valves close, start systole) and S2 (semilunar valves close, start diastole). Murmurs occur between these sounds.'],
  'su2-l2': ['V/Q ratio: normal = 0.8. Dead space (V/Q = infinity): ventilated but not perfused (PE). Shunt (V/Q = 0): perfused not ventilated (pneumonia).','O2 carried 97% bound to hemoglobin (4 O2 per Hgb). CO2 transported 70% as bicarbonate via carbonic anhydrase in RBCs.','Oxygen-hemoglobin dissociation curve shifts RIGHT (unloads O2 more easily) with increased CO2, H+, temperature, 2,3-DPG.','Spirometry: Tidal Volume ~500mL, FVC ~4.8L, FEV1/FVC <0.7 in obstructive disease, normal in restrictive.'],
  'su2-l3': ['Normal ABG: pH 7.35-7.45, PCO2 35-45 mmHg, HCO3 22-26 mEq/L. Outside these ranges = acidosis or alkalosis.','Metabolic acidosis (low pH, low HCO3): DKA, lactic acidosis, renal failure, diarrhea. Compensation: hyperventilation (lowers PCO2).','Respiratory acidosis (low pH, high PCO2): COPD, opioids, neuromuscular disease. Renal compensation: retain HCO3 (takes days).','Anion gap = Na - (Cl + HCO3). Normal = 8-12. Elevated AG acidosis: MUDPILES (Methanol, Uremia, DKA, Propylene glycol, INH, Lactic acidosis, Ethylene glycol, Salicylates).'],
  'su3-l1': ['Sarcomere = Z-line to Z-line. During contraction: A-band constant, I-band and H-zone narrow, Z-lines pulled together.','Excitation-contraction coupling: AP → T-tubule → DHP receptor → ryanodine receptor → Ca2+ release from SR → troponin-C.','Power stroke: myosin head (cocked by ATP hydrolysis) pulls actin, ADP released. New ATP → detachment. No ATP = rigor.','Type I (slow-twitch): oxidative, fatigue-resistant, endurance. Type II (fast-twitch): glycolytic, fatigues quickly, power/speed.'],
  'su3-l2': ['Calcium homeostasis hormones: PTH raises Ca2+; calcitonin lowers Ca2+; active Vitamin D (calcitriol) raises Ca2+ via GI absorption.','PTH mechanism: activates osteoclasts (bone resorption), stimulates renal Ca2+ reabsorption, promotes 1-hydroxylase (calcitriol synthesis).','Vitamin D pathway: skin (UV) → D3 → liver (25-OH) → kidney (1,25-OH = calcitriol). Deficiency: rickets (children), osteomalacia (adults).','Bone remodeling: osteoblasts build bone (ALP elevated). Osteoclasts resorb bone (acid phosphatase elevated).'],
  'su3-l3': ['Collagen types: I (bone, tendon, skin), II (hyaline cartilage), III (vessels, uterus), IV (basement membrane, no fibrils).','Collagen synthesis: proline and lysine hydroxylation in ER (requires Vit C). Failure = scurvy (bleeding, poor wound healing).','Ehlers-Danlos syndrome: defective collagen (most types) → hyperextensible joints, fragile skin. Osteogenesis imperfecta: Type I collagen mutation.','Elastin: stretchy protein in ligaments, large vessels. Cross-linked by lysyl oxidase (requires Cu2+). Marfan: fibrillin defect (not elastin).'],
  'su4-l1': ['Replication is semi-conservative (Meselson-Stahl). Helicase unwinds, SSBPs stabilize, primase makes RNA primer.','DNA Pol III (prokaryotes) or Pol delta/epsilon (eukaryotes) extend primer 5-prime to 3-prime only. Cannot start without primer.','Okazaki fragments on lagging strand: RNA primers removed by Pol I, gaps filled, ligase seals. Each ~100-200 nucleotides in eukaryotes.','DNA repair: mismatch repair (replication errors), NER (bulky lesions from UV/chemicals), BER (small base alterations). Defects cause cancer syndromes.'],
  'su4-l2': ['RNA Pol II transcribes pre-mRNA. Requires TATA box at -25bp, transcription factors (TFIID, TFIIB, etc.) to assemble.','Pre-mRNA processing: 5-prime 7-methylguanosine cap (ribosome recognition), poly-A tail 3-prime (stability), splicing (spliceosome removes introns).','Translation: AUG start (Met), 80S ribosome. A site (incoming aa-tRNA), P site (growing peptide), E site (exits). Stop: UAA, UAG, UGA.','Signal peptides (hydrophobic N-terminus) direct cotranslational translocation to ER. Glycosylation in ER (N-linked) and Golgi (O-linked).'],
  'su4-l3': ['Hardy-Weinberg equilibrium: p + q = 1, p2 + 2pq + q2 = 1. Requires: large population, random mating, no mutation/migration/selection.','Use H-W when given disease prevalence (q2) to find carrier frequency (2pq) — critical MCAT math skill.','Autosomal recessive: skips generations, both parents carriers (2pq). X-linked recessive: males affected, female carriers, no father-to-son.','Missense (wrong AA), nonsense (stop codon), frameshift (insertion/deletion, most severe), silent (same AA, no effect).'],
  'su5-l1': ['Poiseuille: Q = pi*r4*deltaP/(8*eta*L). Flow proportional to r4: doubling radius increases flow 16x. Most powerful variable.','Laminar vs turbulent: Reynolds number Re = rho*v*d/eta. Re > 2000 = turbulent (creates murmurs, dissection risk, aneurysm risk).','Bernoulli: P + 1/2*rho*v2 + rho*g*h = constant. Faster flow = lower pressure (explains venturi, Coanda, aortic stenosis).','Viscosity (eta) of blood increases with hematocrit and decreases at high flow rates. Blood is non-Newtonian (shear-thinning).'],
  'su5-l2': ['Ohm: V = IR. Series: R_total = sum(Rn), same I through all. Parallel: 1/R_total = sum(1/Rn), same V across all.','Capacitors store charge: Q = CV. In DC: block current at steady state (fully charged). In AC: pass current (impedance = 1/omega*C).','RC time constant tau = RC seconds. Capacitor charges to 63% after 1 tau, fully charged after ~5 tau.','Power: P = IV = I2*R = V2/R (watts). Resistors dissipate power as heat. Power delivered to parallel branches depends on individual R.'],
  'su5-l3': ['Gibbs free energy: deltaG = deltaH - T*deltaS. Spontaneous (exergonic): deltaG < 0. Non-spontaneous: deltaG > 0. Equilibrium: deltaG = 0.','Enzymes lower activation energy (Ea) by stabilizing transition state. They NEVER alter deltaG, deltaH, deltaS, or K_eq.','Le Chatelier: system at equilibrium shifts to oppose disturbances. Adding product shifts left; adding reactant shifts right.','At equilibrium: K_eq = products/reactants. Related to deltaG by: deltaG-naught = -RT*lnK. Spontaneous reaction has K > 1.'],
  'im1-l1': ['Acute inflammation: vasodilation and increased permeability (histamine, prostaglandins) → leukocyte extravasation. Neutrophils first (6h), macrophages follow (24-48h).','Prostaglandins from arachidonic acid via COX-1 (constitutive, GI protection, platelets) and COX-2 (inducible, inflammation). NSAIDs block both.','Systemic inflammation: macrophages release TNF-alpha, IL-1, IL-6 → fever, acute-phase proteins (CRP, fibrinogen), leukocytosis.','Granuloma = chronic inflammation: epithelioid macrophages, giant cells, lymphocytes. Causes: TB (caseating), sarcoidosis (non-caseating), Crohn.'],
  'im1-l2': ['Apoptosis: caspase cascade (intrinsic: cytochrome c from mitochondria, extrinsic: Fas/TNF). Cell shrinks, blebs, phagocytosed. No inflammation.','Necrosis types: coagulative (MI, preserved ghost cells), liquefactive (brain abscess, neutrophils), caseous (TB, cheese-like center), fat (pancreatitis).','p53 (tumor suppressor): detects DNA damage → cell cycle arrest (via p21/CDKN1A) → DNA repair or apoptosis (via Bax). Most mutated gene in cancer.','BCl-2 overexpression (t(14;18) translocation in follicular lymphoma): anti-apoptotic, cells survive too long.'],
  'im1-l3': ['Oncogenes (gain-of-function): RAS (G protein, GTPase mutation traps in active state), MYC (transcription factor), HER2 (RTK overexpression in breast).','Tumor suppressors (loss-of-function): Rb (cell cycle brake, phosphorylated by CDK4/6 to release E2F), p53 (guardian of the genome), BRCA1/2 (DNA repair).','Angiogenesis: tumor cells secrete VEGF → new blood vessel formation needed when tumor > 1-2mm (beyond O2 diffusion limit).','Metastasis sequence: invasion → intravasation → survival in circulation (anoikis resistance) → extravasation → colonization.'],
  'im2-l1': ['Bioavailability (F) = fraction of drug reaching systemic circulation unchanged. IV: F=100%. Oral: reduced by intestinal metabolism and hepatic first-pass.','Volume of distribution (Vd): Vd = dose/plasma concentration. Lipophilic drugs: large Vd (distribute to fat, tissues). Hydrophilic: small Vd (stay in plasma).','Half-life: t1/2 = 0.693*Vd/CL. Steady state reached after ~4-5 half-lives (applies to ALL drugs regardless of frequency or dose).','Renal clearance: CL_renal = GFR*fu (filtration) + secretion - reabsorption. Creatinine clearance estimates GFR in clinical practice.'],
  'im2-l2': ['Potency (ED50): dose producing 50% maximal effect. More potent drug has LOWER ED50. Efficacy (Emax): maximum achievable effect.','Full agonist: reaches 100% Emax. Partial agonist: reaches < 100% Emax (acts as antagonist in presence of full agonist). Inverse agonist: decreases baseline activity.','Competitive antagonist: shifts dose-response curve RIGHT (increases EC50), does NOT change Emax. Can be overcome with more agonist.','Therapeutic index TI = LD50/ED50. Narrow TI drugs: warfarin (INR monitoring), lithium, digoxin, aminoglycosides, phenytoin, cyclosporine.'],
  'im2-l3': ['Phase I (CYP450): oxidation (most common), reduction, hydrolysis. Products may be active (prodrugs like codeine→morphine) or inactive.','CYP inducers (increase metabolism, decrease drug effect): rifampin, phenytoin, carbamazepine, phenobarbital, St. Johns Wort.','CYP inhibitors (decrease metabolism, increase drug levels/toxicity): ketoconazole, erythromycin, grapefruit, isoniazid, cimetidine.','Phase II: conjugation reactions (glucuronidation, sulfation, acetylation, glutathione). Products more water-soluble for renal/biliary excretion.'],
  'im3-l1': ['Hypothalamic hormones: CRH, TRH, GnRH, GHRH, somatostatin, dopamine (inhibits prolactin). All stimulate anterior pituitary except somatostatin and dopamine.','Anterior pituitary (FLAT PiG): FSH, LH, ACTH, TSH, Prolactin, (i), GH. Posterior: ADH and oxytocin (made in hypothalamus, stored in posterior pituitary).','Negative feedback: most hormones. Exception: estrogen produces POSITIVE feedback at LH surge triggering ovulation (mid-cycle peak).','Pituitary adenoma effects: if large → bitemporal hemianopsia (compression of optic chiasm). Prolactinoma (most common): galactorrhea, amenorrhea.'],
  'im3-l2': ['Thyroid hormone synthesis: thyroglobulin iodinated by thyroid peroxidase → MIT/DIT → T3/T4. Stored in colloid. Released by proteolysis.','T4 is a prohormone; converted to active T3 by 5-deiodinase in peripheral tissues (liver, kidney, muscle).','Effects of thyroid hormone: increased BMR, thermogenesis, protein synthesis, GI motility, cardiac output (beta-1 receptors upregulated), bone resorption.','Adrenal cortex layers: zona Glomerulosa (aldosterone, controlled by angiotensin II/K+), Fasciculata (cortisol, controlled by ACTH), Reticularis (DHEA, ACTH).'],
  'im3-l3': ['Insulin actions: GLUT4 translocation to membrane (muscle, fat), glycogen synthesis (liver, muscle), lipogenesis, protein synthesis, cellular uptake of K+.','Type 1 DM: absolute insulin deficiency, prone to DKA (no insulin → free fatty acid release → ketogenesis → ketoacidosis).','Type 2 DM: insulin resistance (GLUT4 not responding) + eventual beta-cell exhaustion. Metformin first-line: decreases hepatic gluconeogenesis.','Complications of hyperglycemia: non-enzymatic glycation → AGEs → microangiopathy (retinopathy, nephropathy, neuropathy) and macrovascular disease (CAD, stroke, PVD).'],
  'im4-l1': ['Galvanic cell: spontaneous (deltaG < 0, E_cell > 0). Electrolytic cell: nonspontaneous, requires external voltage.','Standard reduction potentials: more positive = better oxidizing agent (cathode). E_cell = E_cathode - E_anode at standard conditions.','Nernst equation: E = E-naught - (0.0592/n)*log(Q) at 25C. Cell at equilibrium: E = 0, Q = K.','Relationship: deltaG-naught = -nFE-naught. F = Faraday constant = 96,485 C/mol. n = moles of electrons transferred.'],
  'im4-l2': ['Strong acids (HCl, H2SO4, HNO3, HBr, HClO4): fully dissociate, Ka very large. Weak acids: partial dissociation, Ka = [H+][A-]/[HA].','Henderson-Hasselbalch: pH = pKa + log([A-]/[HA]). Buffer works best when pH = pKa +/- 1 (1:1 to 10:1 ratio of conjugate base to acid).','Bicarbonate buffer: H+ + HCO3- → H2CO3 → CO2 + H2O. Lungs control CO2 (fast); kidneys control HCO3 (slow, days).','Polyprotic acids lose protons sequentially. Phosphate buffer (pKa 6.8) most effective at intracellular pH. Bicarbonate (pKa 6.1) most physiologically important.'],
  'im4-l3': ['Osmolarity = total solute concentration (osmol/L). Osmolality = osmol/kg solvent. Clinically: serum Osm = 2[Na+] + [glucose]/18 + [BUN]/2.8.','Van\'t Hoff factor (i): NaCl → i=2, CaCl2 → i=3, glucose → i=1. Osmotic pressure pi = iMRT.','Tonicity effects: isotonic (no change in cell volume), hypertonic solution (cell crenates/shrinks, water leaves cell), hypotonic (cell swells, lyses).','Colligative properties: boiling point elevation = i*Kb*m, freezing point depression = i*Kf*m. Both proportional to number of solute particles.'],
  'im5-l1': ['Classical conditioning: UCS → UCR. CS paired with UCS repeatedly → CS alone → CR. Key: CS must predict UCS.','Operant conditioning (Skinner): positive reinforcement (add reward), negative reinforcement (remove aversion), punishment (decrease behavior).','Reinforcement schedules: Fixed-ratio: fast response, post-reinforcement pause. Variable-ratio: fastest and most resistant to extinction (slot machines).','Memory systems: sensory (seconds), short-term/working memory (7 +/-2 items, ~30s), long-term (explicit: episodic/semantic; implicit: procedural, priming).'],
  'im5-l2': ['FAE (Fundamental Attribution Error): when explaining OTHERS behavior, overestimate personality/disposition, underestimate situation.','Actor-observer bias: explain OWN behavior situationally, explain OTHERS behavior dispositionally. Reduced when we take the other perspective.','Self-serving bias: attribute success to internal factors (skill, ability), attribute failure to external factors (luck, difficulty). Protects self-esteem.','In-group bias: more positive attributions and better treatment of in-group members. Out-group homogeneity bias: see out-group as more similar than they are.'],
  'im5-l3': ['Social determinants of health (WHO framework): income, employment, education, housing, food security, social support, access to care.','SES gradient: nearly universal across all cultures. Even middle-class has worse health than upper-class. Not just poverty vs non-poverty.','Health inequities vs health inequalities: inequities are systematic, avoidable, and unjust (socially determined differences in health).','Cultural humility vs cultural competency: humility = ongoing self-reflection and critique. Competency implies static mastery that may stereotype.'],
  'pe1-l1': ['Three germ layers: ectoderm (skin, CNS, PNS), mesoderm (muscle, bone, cardiovascular, kidneys, gonads), endoderm (GI, respiratory, liver, pancreas, thyroid).','Neural tube closure by week 4. Failure: anencephaly (anterior), spina bifida (posterior). Alpha-fetoprotein elevated in open NTDs on maternal serum screening.','Critical period (teratogen sensitivity): weeks 3-8 organogenesis. After: growth/function affected, not major structural defects.','Fetal hemoglobin (HbF, alpha2-gamma2): higher O2 affinity than HbA (alpha2-beta2) due to less binding of 2,3-DPG. Allows O2 transfer from maternal to fetal blood.'],
  'pe1-l2': ['Motor milestones: head control 4 mo, sits unsupported 6 mo, stands 9 mo, walks 12 mo, runs 18 mo, hops on one foot 4 yr.','Language milestones: coos 2 mo, babbles 6 mo, mama/dada (nonspecific) 9 mo, first words 12 mo, 2-word phrases 24 mo, sentences 3 yr.','Social milestones: social smile 2 mo, stranger anxiety 6-9 mo, separation anxiety 9-12 mo, parallel play 2-3 yr, cooperative play 3-4 yr.','Red flags requiring evaluation: no babbling by 12 mo, no single words by 16 mo, no 2-word phrases by 24 mo, any regression in language or social skills.'],
  'pe1-l3': ['Down syndrome (T21): most common chromosomal disorder (1/700). Simian crease, AV canal defect, Hirschsprung, hypothyroid, Alzheimer risk after age 35.','Turner syndrome (45,X): female, short stature, webbed neck, shield chest, coarctation of aorta, bicuspid aortic valve, primary amenorrhea, infertile, normal IQ.','Klinefelter (47,XXY): male, tall, small firm testes, infertile (azoospermia), gynecomastia, high FSH/LH, treat with testosterone.','Non-disjunction: failure of chromosome separation. Meiosis I error more common. Maternal age strongly increases risk (trisomies, not monosomy X).'],
  'pe2-l1': ['Innate immunity: immediate response (seconds-hours), nonspecific, no memory. Components: neutrophils, macrophages, NK cells, complement, barriers.','Adaptive immunity: slower (days), highly specific, long-lasting memory. T cells (cell-mediated) and B cells/plasma cells (antibody-mediated/humoral).','MHC I (HLA-A,B,C) on all nucleated cells: presents endogenous (intracellular) peptides to CD8+ cytotoxic T cells. Viral infection/cancer.','MHC II (HLA-DR,DP,DQ) on professional APCs (dendritic cells, macrophages, B cells): presents exogenous peptides to CD4+ helper T cells.'],
  'pe2-l2': ['Live-attenuated vaccines: MMR, varicella, rotavirus, yellow fever, oral typhoid. Strongest immunity, single dose often sufficient. Contraindicated: pregnant, immunocompromised.','Inactivated vaccines: influenza (injection), hepatitis A, IPV, rabies. Safer, but may need multiple doses/boosters. Less robust immune response.','Conjugate vaccines: attach polysaccharide antigen to protein carrier → T-cell dependent response. Examples: Hib, pneumococcal, meningococcal.','Herd immunity: when enough of population is immune, chains of infection break. Threshold = 1 - 1/R0. Measles R0 ~12-18, needs ~95% immunity.'],
  'pe2-l3': ['RSV: leading cause of hospitalization in infants < 2 yr. Presents as bronchiolitis (wheezing, hyperinflation). Treatment: supportive (O2, hydration).','Kawasaki disease (mucocutaneous lymph node syndrome): fever ≥5 days + 4/5 CRASH criteria: Conjunctivitis, Rash, Adenopathy, Strawberry tongue, Hand/foot changes.','Croup (laryngotracheobronchitis): parainfluenza virus, barking/seal-like cough, inspiratory stridor, steeple sign on X-ray. Treat: racemic epinephrine, dexamethasone.','Bacterial meningitis empiric treatment by age: neonates: ampicillin + gentamicin. Infants/children: ceftriaxone +/- vancomycin. Add dexamethasone to reduce inflammation.'],
  'pe3-l1': ['Sensorimotor (0-2 yr): learns through senses/motor actions. Object permanence develops 8-12 months. End: symbolic thought (can represent absent objects).','Preoperational (2-7 yr): language develops, symbolic/pretend play, but EGOCENTRIC (cannot take others\' perspective). Cannot conserve.','Concrete operational (7-11 yr): conservation (quantity unchanged despite shape change), reversibility, classification, seriation. Logic only for concrete objects.','Formal operational (12+ yr): abstract reasoning, hypothetical-deductive thinking. Not all adults consistently reach this stage.'],
  'pe3-l2': ['Bowlby-Ainsworth Strange Situation: infant placed with caregiver, stranger enters, caregiver leaves, stranger comforts, caregiver returns.','Secure (60-65%): distressed at separation, quickly soothed at reunion by caregiver. Sensitive caregiving. Best developmental outcomes.','Anxious-ambivalent (10-15%): very distressed, difficult to soothe even after reunion. Inconsistent parental availability.','Avoidant (20-25%): minimal distress at separation, ignores/avoids caregiver at reunion. Emotionally unavailable parenting.'],
  'pe3-l3': ['Stage 1: Trust vs Mistrust (0-18 mo): consistent caregiving → trust and hope. Failure: fear and insecurity. Virtue: hope.','Stage 3: Initiative vs Guilt (3-6 yr): take initiative, explore world → purpose. Overly restricted → guilt and inhibition.','Stage 5: Identity vs Role Confusion (12-18 yr): form coherent identity → fidelity. Failure: identity confusion. Most tested MCAT stage.','Stage 8: Integrity vs Despair (65+ yr): reflect on life with satisfaction → wisdom. Regret over missed opportunities → despair.'],
  'pe4-l1': ['Fat-soluble vitamins ADEK stored in liver and adipose. Can accumulate to toxic levels (hypervitaminosis A: pseudotumor cerebri; D: hypercalcemia).','Vitamin A (retinol): vision (retinal in rhodopsin), epithelial integrity (deficiency: night blindness, Bitots spots, xerophthalmia).','B1 (thiamine/TPP): cofactor for PDH, alpha-KG dehydrogenase, transketolase. Deficiency: Wernicke-Korsakoff (chronic alcoholics), beriberi.','B12 (cobalamin): requires intrinsic factor for ileal absorption. Deficiency: megaloblastic anemia + subacute combined degeneration of spinal cord (demyelination of dorsal and lateral columns).'],
  'pe4-l2': ['Lipoprotein structure: phospholipid monolayer + cholesterol + apolipoproteins surrounding hydrophobic core of triglycerides and cholesterol esters.','Exogenous pathway: dietary fat → intestinal cells → chylomicrons → lymphatics → blood → lipoprotein lipase (capillaries) → cells use TG → chylomicron remnants → liver.','Endogenous pathway: liver makes VLDL → LDL → peripheral tissues via LDL receptor (LDLR). PCSK9 degrades LDLR (statins upregulate LDLR).','Abetalipoproteinemia: cannot make chylomicrons or VLDL → fat-soluble vitamin deficiency, acanthocytes, ataxia.'],
  'pe4-l3': ['Urea cycle: starts and ends in mitochondria; middle steps in cytosol. Net: NH3 + CO2 + 3 ATP → urea (excreted by kidneys) + ornithine (regenerated).','OTC deficiency (ornithine transcarbamylase): X-linked recessive, most common urea cycle disorder. High NH3 + orotic acid, low citrulline/arginine.','Hyperammonemia symptoms: vomiting, lethargy, cerebral edema, encephalopathy. Treatment: protein restriction, lactulose, sodium benzoate/phenylacetate.','Essential amino acids enter TCA via transamination. Glucogenic AAs (most) → glucose. Ketogenic AAs (Leu, Lys exclusively) → ketone bodies.'],
  'pe5-l1': ['Case-control: retrospective, select cases (have disease) and controls (do not), look back for exposures. Fast, cheap, good for rare diseases. Calculates OR.','Cohort: prospective (or retrospective), select exposed and unexposed, follow for outcomes. Can calculate incidence and RR. Time-consuming, expensive.','RCT: randomly assign to intervention or control, prospective. Gold standard for causation. Randomization controls for known and unknown confounders.','Confounding variable: associated with both exposure and outcome but is not on causal pathway. Controlled by randomization (RCT) or statistical methods.'],
  'pe5-l2': ['2x2 table: TP (true positive), FP (false positive), FN (false negative), TN (true negative). Sensitivity = TP/(TP+FN). Specificity = TN/(TN+FP).','PPV = TP/(TP+FP). Increases with higher disease prevalence. NPV = TN/(TN+FN). Increases with lower disease prevalence.','Likelihood ratio positive (LR+) = sensitivity/(1-specificity). High LR+ rules IN disease. LR- = (1-sensitivity)/specificity. Low LR- rules OUT disease.','NNT = 1/ARR (absolute risk reduction) = 1/(control rate - treatment rate). Smaller NNT = more effective intervention.'],
  'pe5-l3': ['Belmont Report (1979) core principles: (1) Respect for persons = autonomy and informed consent, (2) Beneficence = maximize benefit, minimize harm, (3) Justice = fair distribution of research burdens and benefits.','Informed consent elements: disclosure (risks, benefits, alternatives, confidentiality), comprehension, voluntariness, decision-making capacity (competence).','IRB (Institutional Review Board): must review and approve all research involving human subjects before it begins. Assesses risk-benefit ratio.','Vulnerable populations require extra protections: children (need parental consent + child assent), prisoners (potential coercion), pregnant women, cognitively impaired persons.'],
  'ps1-l1': ['Resting membrane potential (-70 mV): maintained by Na+/K+ ATPase (3 Na+ out, 2 K+ in = electrogenic, contributes ~-3 mV) and K+ leak channels (major contributor).','Action potential: depolarization (-70 to +30 mV: Na+ in via voltage-gated Na+ channels, threshold -55 mV). Repolarization: K+ out. Hyperpolarization: brief dip below -70 mV.','Absolute refractory period: Na+ channels inactivated, no AP possible regardless of stimulus strength. Relative refractory: possible with suprathreshold stimulus.','Saltatory conduction in myelinated axons: AP jumps between nodes of Ranvier (unmyelinated). Much faster than continuous conduction in unmyelinated fibers.'],
  'ps1-l2': ['Dopamine pathways: mesolimbic (reward/addiction), mesocortical (cognitive/emotional), nigrostriatal (movement, lost in Parkinson), tuberoinfundibular (inhibits prolactin).','GABA: major inhibitory NT. GABA-A: ionotropic (Cl- channel, opens more frequently with benzos). GABA-B: metabotropic (K+ conductance, Ca2+ block). Target of alcohol, barbiturates, benzos.','Glutamate: major excitatory NT. AMPA: fast, Na+ entry, short-term plasticity. NMDA: Ca2+ entry, requires depolarization (Mg2+ removal) + glycine co-agonist. Critical for LTP/memory.','Second messengers: Gs → adenylyl cyclase → cAMP → PKA. Gi → inhibits AC → decreased cAMP. Gq → PLC → IP3 (Ca2+ release) + DAG (PKC activation).'],
  'ps1-l3': ['Frontal lobe: motor cortex (primary motor), Broca area (speech production, dominant hemisphere), prefrontal cortex (executive function, personality, working memory).','Temporal lobe: primary auditory cortex, Wernicke area (speech comprehension, dominant hemisphere), hippocampus (memory formation), amygdala (fear/emotion).','Parietal lobe: primary somatosensory cortex (contralateral body), spatial processing, Gerstmann syndrome (dominant): acalculia, agraphia, finger agnosia, L-R confusion.','Cerebellum: ipsilateral coordination. Damage: PAST syndrome: dysdiadochokinesia, ataxia, scanning speech, tremor (intention). Basal ganglia: movement initiation (direct pathway) and inhibition (indirect pathway).'],
  'ps2-l1': ['Absolute threshold: minimum stimulus for detection 50% of the time. JND (just noticeable difference): smallest detectable change in stimulus intensity.','Weber\'s Law: JND/stimulus intensity = k (constant). Implies logarithmic relationship. Fechner: sensation = k * log(stimulus). Stevens\' power law: sensation = k * (stimulus)^n.','Signal detection theory: d-prime (d\') = sensitivity (independent of bias). Criterion (beta) = willingness to say "yes" (liberal vs conservative). Hits, misses, false alarms, correct rejections.','Sleep stages: 4 NREM stages (N1 light, N3 deep/delta waves/slow wave sleep) + REM (active brain, atonia, vivid dreams). Cycle ~90 minutes. REM increases, N3 decreases through night.'],
  'ps2-l2': ['James-Lange theory: stimulus → physiological arousal → emotion ("we feel afraid because we shake"). Cannon-Bard: arousal and emotion simultaneously and independently.','Schachter-Singer two-factor theory: physiological arousal + cognitive attribution/label = specific emotion. Misattribution of arousal possible.','Maslow hierarchy: Physiological → Safety → Love/Belonging → Esteem → Self-actualization. Deficiency needs (lower 4) vs growth needs (top). Must meet lower before higher.','HPA axis: hypothalamus (CRH) → anterior pituitary (ACTH) → adrenal cortex (cortisol). Chronic stress: immunosuppression, hippocampal damage, hyperglycemia.'],
  'ps2-l3': ['DSM-5 diagnostic criteria: must cause significant distress OR functional impairment. Removed multiaxial system. Cultural context considered.','Major depressive disorder: SIG E CAPS for 2+ weeks (Sleep, Interest/anhedonia, Guilt/worthlessness, Energy, Concentration, Appetite, Psychomotor, Suicidality/death).','Bipolar I: at least one manic episode (7 days, DIGFAST). Bipolar II: hypomania + major depression. Cyclothymia: 2 yr of hypomania + depressive symptoms (not full episodes).','Personality disorders: Cluster A (odd/eccentric: paranoid, schizoid, schizotypal), B (dramatic/emotional: antisocial, borderline, histrionic, narcissistic), C (anxious: avoidant, dependent, OCPD).'],
  'ps3-l1': ['Social class in US: not a caste system but relatively rigid. Wealth, income, education, and occupational prestige all contribute to SES.','Health gradient: even small differences in SES correspond to measurable differences in health outcomes (Whitehall studies of British civil servants).','Social capital (Putnam): networks of relationships that facilitate collective action. Bonding (within group) and bridging (between groups) social capital.','Relative deprivation theory: perceiving oneself as worse off than others in the same society causes psychological stress with real health consequences.'],
  'ps3-l2': ['Culture is learned (not instinctual), shared (within a group), symbolic (language, ritual), integrated (aspects interconnected), and dynamic (changes over time).','Enculturation = learning one\'s own culture from birth. Acculturation = adapting to a new culture. Can result in assimilation (adopt new), integration, separation, or marginalization.','Race is a social construct, not a biological category. Genetic variation within racial groups often exceeds variation between groups.','Structural racism: systemic policies and institutions that create and maintain racial inequity (redlining, mass incarceration, unequal education funding). Affects health outcomes.'],
  'ps3-l3': ['Asch conformity: when confederates all gave wrong answers, 75% of real subjects conformed at least once. Larger groups and unanimous confederates = more conformity.','Milgram obedience (1961-62): 65% administered maximum 450V shock when instructed by authority in lab coat. Proximity to victim reduced obedience significantly.','Bystander effect (Darley & Latane): more bystanders → less individual helping. Two mechanisms: (1) diffusion of responsibility and (2) pluralistic ignorance.','Social loafing: individuals exert less effort in groups (Ringelmann rope-pulling experiment). Reduced when individual contributions are identifiable.'],
  'ps4-l1': ['SSRIs (fluoxetine, sertraline, escitalopram): block SERT → more serotonin in synapse. First-line for depression and most anxiety disorders. 2-4 weeks for therapeutic effect.','MAOIs (phenelzine, tranylcypromine): block monoamine oxidase → increased 5-HT, NE, DA. Risk: tyramine crisis (hypertensive emergency) from aged cheese, cured meats.','Typical antipsychotics (haloperidol, chlorpromazine): D2 blockade, treat positive symptoms. EPS: acute dystonia (hours), akathisia (days), Parkinsonism (weeks), tardive dyskinesia (months-years).','Clozapine: broadest spectrum (positive, negative, cognitive), but risk of agranulocytosis (weekly CBC required) and seizures. No EPS. Last resort for treatment-resistant schizophrenia.'],
  'ps4-l2': ['Benzodiazepines (diazepam, lorazepam, alprazolam): bind between alpha and gamma subunits of GABA-A → increase FREQUENCY of Cl- channel opening (NOT duration).','Barbiturates (phenobarbital): bind GABA-A at different site → increase DURATION of Cl- channel opening. Greater overdose risk (no ceiling effect on CNS depression).','Lithium: effective for acute mania and bipolar maintenance. Narrow TI (serum level 0.6-1.2 mEq/L). Toxicity: tremor, polyuria, diabetes insipidus, hypothyroidism, teratogen.','Valproate: inhibits voltage-gated Na+ channels and increases GABA. Used for bipolar, epilepsy. Teratogen (neural tube defects). Monitor LFTs and CBC.'],
  'ps4-l3': ['LTP (long-term potentiation): strengthening of synapse with repeated stimulation. Requires NMDA receptor activation (coincidence detector: requires glutamate + depolarization).','NMDA receptor mechanism: under resting conditions, Mg2+ blocks the channel. Depolarization from AMPA receptors removes Mg2+ block. Ca2+ influx → CaMKII activation → AMPA insertion.','BDNF (brain-derived neurotrophic factor): promotes neuronal survival and synaptic plasticity. Reduced in depression. Increased by exercise, antidepressants, learning.','Adult neurogenesis: dentate gyrus of hippocampus and olfactory bulb. Stimulated by exercise, environmental enrichment, antidepressants. Inhibited by chronic stress, alcohol, aging.'],
  'ps5-l1': ['Operational definition: defines abstract concept in concrete, measurable terms. Essential for replication. Example: depression = score > 15 on PHQ-9.','Validity types: construct (measures what it claims), internal (causal inferences valid), external (generalizable), ecological (applies to real-world settings).','Reliability: consistency of measurement. Test-retest (stable over time), inter-rater (consistent between observers), internal consistency (Cronbach alpha for questionnaires).','Demand characteristics: participants change behavior based on guesses about study purpose. Controlled by cover story, deception (requires debriefing), or blind design.'],
  'ps5-l2': ['Measures of central tendency: mean (affected by outliers), median (resistant to outliers, better for skewed data), mode (most frequent value).','Variance = average squared deviation from mean. Standard deviation = square root of variance. SEM = SD/sqrt(n). CI = estimate +/- (z or t) * SEM.','Correlation coefficient r: ranges from -1 to +1. r2 = coefficient of determination (proportion of variance explained). Never implies causation.','Regression: predicts one variable from another. Logistic regression: binary outcome (disease yes/no). Multiple regression: control for confounders.'],
  'ps5-l3': ['Tuskegee Syphilis Study (1932-1972): 399 Black men with latent syphilis given placebo; penicillin withheld even after becoming standard of care in 1947. Exposed by journalist in 1972.','National Research Act (1974) established IRBs. Belmont Report (1979) articulated 3 principles: respect for persons, beneficence, justice.','Declaration of Helsinki (1964): international standards for medical research. Requires ethics committee approval, informed consent, risk-benefit assessment.','Common Rule (45 CFR 46): US federal regulations for human subjects research. Sets IRB requirements, consent standards, protections for vulnerable populations.'],
  're1-l1': ['Gene regulation at transcription level: enhancers (up to 1Mbp away) interact with promoters via chromatin looping mediated by cohesin and CTCF.','Histone code: H3K4me3 (active promoter), H3K27ac (active enhancer), H3K27me3 (polycomb repression), H3K9me3 (constitutive heterochromatin).','CpG islands: regions of high CG content near promoters. Methylation of CpG silences gene. Used in X-inactivation and genomic imprinting.','miRNA: ~22 nt, transcribed as pri-miRNA → pre-miRNA (Drosha/DGCR8 in nucleus) → mature miRNA (Dicer in cytoplasm) → RISC complex → silences target mRNA.'],
  're1-l2': ['Protein secondary structure: alpha-helix (H-bonds within single chain between C=O and N-H separated by 4 residues) and beta-sheet (H-bonds between adjacent strands).','Chaperonins (GroEL/GroES in bacteria, CCT in eukaryotes): form barrel-like cavity that allows protein to fold in isolation away from aggregation.','Ubiquitin-proteasome system: proteins tagged with ubiquitin (Ub) chains via E1-E2-E3 ligase cascade → targeted for degradation by 26S proteasome.','Prion diseases: CJD (sporadic, iatrogenic, familial), vCJD (variant, from BSE-infected beef), kuru (from ritualistic cannibalism), fatal familial insomnia.'],
  're1-l3': ['CRISPR-Cas9 discovery: Jennifer Doudna and Emmanuelle Charpentier won 2020 Nobel Prize for developing it as a programmable genome editing tool.','PAM sequence (protospacer adjacent motif): NGG for SpCas9 (from Streptococcus pyogenes). Required immediately 3-prime of target. Limits targetable sequences.','Off-target effects: Cas9 can cut sites with partial complementarity. Addressed by: high-fidelity Cas9 variants (eSpCas9), paired nickases, base editors.','Base editors: convert one base to another without DSB. Cytosine base editor (CBE): C→T. Adenine base editor (ABE): A→G. Higher precision, fewer off-targets.'],
  're2-l1': ['Measures of disease frequency: incidence rate (new cases/person-time), cumulative incidence (risk), prevalence = incidence × duration.','Incidence rate from cohort studies. Prevalence from cross-sectional studies. Prevalence changes with incidence, duration, and emigration of cases.','Calculating OR from 2x2 table: OR = (a*d)/(b*c). Calculating RR from cohort: RR = [a/(a+b)] / [c/(c+d)].','Attributable risk (AR): absolute difference in disease rates (incidence_exposed - incidence_unexposed). AR% = AR/incidence_exposed × 100.'],
  're2-l2': ['Hypothesis testing: null hypothesis (H0) = no effect. Reject H0 if p-value < alpha (typically 0.05). Never "accept" the null, only "fail to reject."','Confidence interval: 95% CI = range where the true population parameter lies 95% of the time. CI not crossing null (0 for difference, 1 for ratio) = statistically significant.','Statistical vs clinical significance: statistically significant result may have very small (clinically unimportant) effect size. Large n can detect trivial differences.','ANOVA (analysis of variance): compares means of 3+ groups simultaneously using F-statistic. Post-hoc tests (Bonferroni, Tukey) needed for pairwise comparisons.'],
  're2-l3': ['Cochrane Collaboration: gold standard for systematic reviews in medicine. PRISMA guidelines for reporting systematic reviews and meta-analyses.','Heterogeneity: I2 statistic measures proportion of variability due to true differences between studies (not sampling error). I2 > 50%: substantial heterogeneity.','Sources of bias in meta-analysis: publication bias (positive results more likely published), language bias, duplicate publication, selective reporting.','Network meta-analysis: compares multiple interventions indirectly through common comparator. Can estimate relative efficacy of treatments never directly compared.'],
  're3-l1': ['¹H NMR: chemical shift (ppm) reflects electron density. Deshielded protons (near electronegative atoms): higher ppm. TMS = reference (0 ppm).','Key IR frequencies: O-H (3200-3600 cm-1, broad), N-H (3300-3500 cm-1), C=O (1700-1750 cm-1 ketone/aldehyde, 1735-1750 ester, 1670-1690 amide).','Mass spectrometry fragmentation: lose 15 (CH3), 29 (CHO), 43 (CH3CO for methyl ketones), 77 (phenyl). M+2 pattern: Cl (3:1 ratio), Br (1:1 ratio).','UV-Vis Beer-Lambert law: A = epsilon*l*c. Absorbance proportional to concentration and path length. Molar absorptivity (epsilon) is compound-specific.'],
  're3-l2': ['HPLC (high-performance liquid chromatography): separates by differential affinity for stationary and mobile phases at high pressure. Reverse-phase (C18): nonpolar stationary.','Western blot: SDS-PAGE separates proteins → transfer to PVDF membrane → block → 1° antibody → 2° antibody (HRP-conjugated) → chemiluminescence detection.','ELISA: solid-phase immunoassay. Sandwich ELISA uses capture antibody + detection antibody + enzyme substrate. Highly sensitive, can quantify antigen concentration.','Flow cytometry: antibodies tagged with fluorophores bind cell surface markers. Laser excites fluorophores. Detects size (FSC), granularity (SSC), and fluorescence intensity.'],
  're3-l3': ['Zero-order kinetics: rate = k (constant, independent of concentration). [A] decreases linearly with time. Half-life increases as concentration decreases. Alcohol metabolism, aspirin overdose.','First-order kinetics: rate = k[A]. [A] decreases exponentially. Constant half-life (t1/2 = 0.693/k). Most drug clearance follows first-order kinetics.','Collision theory: molecules must collide with sufficient energy (> Ea) and proper orientation to react. Temperature increases both collision frequency and fraction with sufficient energy.','Hammond postulate: transition state resembles the species it is closer in energy to. Endothermic reactions: TS resembles products. Exothermic: TS resembles reactants.'],
  're4-l1': ['B cell activation requires 2 signals: (1) BCR crosslinking by antigen and (2) CD40L (on T helper cell) binding CD40 (on B cell). T-independent antigens (polysaccharides) only need signal 1.','Germinal center reaction: B cells undergo somatic hypermutation of VDJ region (by AID enzyme) → selection of highest affinity clones by FDC → plasma cells or memory B cells.','Class switching (isotype switching): DNA recombination replaces C-region gene segment. Ig stays same antigen specificity but changes Fc region (effector functions). Requires AID.','Primary response: IgM first (5-10 days, low titer). Secondary (memory) response: IgG predominantly, higher titer, faster (2-3 days), more durable. Basis of vaccination.'],
  're4-l2': ['Bacterial structure: gram-positive (thick peptidoglycan, teichoic acid, no outer membrane) vs gram-negative (thin PG + outer membrane with LPS). Crystal violet stain.','Toxin mechanisms: cholera toxin (ADP-ribosylates Gs → constitutively active → cAMP → Cl- secretion → watery diarrhea), botulinum (cleaves SNARE proteins → no ACh release → paralysis).','Biofilm formation: bacteria attach to surface → secrete extracellular matrix → highly resistant to antibiotics and host immune defenses. Major cause of chronic infections.','Antigenic variation: Borrelia uses cassette system to vary VlsE protein. Trypanosoma brucei sequentially expresses different VSG genes (>1000 variants).'],
  're4-l3': ['HIV structure: two copies of ssRNA, reverse transcriptase, integrase, protease, matrix, capsid, envelope (gp41 transmembrane + gp120 surface).','HIV replication: gp120 binds CD4 + CCR5/CXCR4 → gp41 mediates fusion → uncoating → reverse transcription (RNA → cDNA) → nuclear import → integrase-mediated integration → transcription → assembly → protease → mature virion.','Antiviral drug mechanisms: nucleoside/nucleotide analogs (chain terminators), non-nucleoside inhibitors (allosteric RT inhibition), protease inhibitors (prevent polyprotein cleavage), integrase inhibitors.','Phage lambda: lytic vs lysogenic decision made by cI repressor (lysogeny) vs Cro protein (lysis). UV damage → RecA → cI cleavage → switch to lytic cycle.'],
  're5-l1': ['SN2 characteristics: bimolecular, concerted single-step, rate = k[nucleophile][substrate], backside attack → Walden inversion at chiral center, retention of overall configuration if attack at achiral carbon.','SN2 substrate preference: methyl > primary > secondary. Tertiary: no SN2 due to steric hindrance. Branching at beta-carbon also slows SN2.','SN1 characteristics: unimolecular, 2 steps (carbocation intermediate), rate = k[substrate], carbocation attacked from both sides → racemization (or partial racemization if chiral center).','Solvent effects: polar protic (water, alcohols) favor SN1 by stabilizing carbocation and nucleophile. Polar aprotic (DMSO, DMF, acetone) favor SN2 by not caging nucleophile.'],
  're5-l2': ['Nucleophilic acyl substitution reactivity: acid chlorides > anhydrides > esters > carboxylic acids > amides (decreasing electrophilicity of carbonyl).','Grignard reagent (RMgBr): strong nucleophile and strong base. Reacts with aldehydes → secondary alcohol, ketones → tertiary alcohol, CO2 → carboxylic acid.','Michael addition: nucleophile (Michael donor) adds to beta-carbon of alpha,beta-unsaturated carbonyl (Michael acceptor) in 1,4 (conjugate) addition.','Acetal formation: hemiacetal (1 ROH) + 1 more ROH + acid catalyst + remove H2O → acetal. Acetals are stable to base and nucleophiles → used as protecting groups.'],
  're5-l3': ['Fischer projection: horizontal bonds come OUT of page (toward you), vertical bonds go INTO page (away from you). Used for sugars and amino acids.','Nomenclature: R and S at each stereocenter. Diastereomers: multiple stereocenters where not all are inverted. Maximum stereoisomers = 2^n (n = stereocenters).','Meso compound: achiral molecule with stereocenters that cancel out due to internal mirror plane. Optically inactive despite having stereocenters.','Chiral chromatography (chiral stationary phase) or chiral derivatizing agents needed to separate enantiomers (they have identical physical properties in achiral environment).'],
};

/* ═══════════════════════════════════════════════════════════════════
   QUESTION BANK
═══════════════════════════════════════════════════════════════════ */

const Q_TEMPLATES = [
  { cat: 'Chem/Phys', text: 'A fluid flows through a tube. The pressure gradient is tripled and the radius is halved. The new flow rate compared to original is:', choices: ['3/16 of the original', '3/8 of the original', '3/4 of the original', '6 times the original'], ans: 0, exp: "Poiseuille: Q = pi*r4*deltaP/(8*eta*L). New Q = Q0 * 3 * (1/2)^4 = 3/16 Q0. Radius has r^4 effect." },
  { cat: 'Bio/Biochem', text: 'A competitive inhibitor is added to an enzyme-substrate reaction. What happens to Km and Vmax?', choices: ['Km increases; Vmax unchanged', 'Vmax decreases; Km unchanged', 'Both Km and Vmax increase', 'Neither parameter changes'], ans: 0, exp: 'Competitive inhibitors compete with substrate for the active site. Excess substrate overcomes inhibition, Vmax unchanged, apparent Km rises.' },
  { cat: 'Bio/Biochem', text: "Which molecule is directly consumed during myosin's power stroke?", choices: ['ATP', 'NADH', 'Creatine phosphate', 'GTP'], ans: 0, exp: 'Myosin ATPase hydrolyzes ATP directly to power the conformational change. Creatine phosphate regenerates ATP but is not directly used.' },
  { cat: 'Chem/Phys', text: 'Light travels from water (n=1.33) into denser glass (n=1.50) at 45 degrees. The refracted ray:', choices: ['Bends toward the normal (angle < 45 degrees)', 'Bends away from the normal (angle > 45 degrees)', 'Passes straight through (angle = 45 degrees)', 'Undergoes total internal reflection'], ans: 0, exp: "Snell's law: n1*sin(theta1) = n2*sin(theta2). Since n2 > n1, the ray bends toward the normal." },
  { cat: 'Psych/Soc', text: 'Bystanders at an emergency see others not responding and also refrain from helping. Best explained by:', choices: ['Diffusion of responsibility', 'Fundamental attribution error', 'In-group bias', 'Cognitive dissonance'], ans: 0, exp: 'Bystander effect: each person feels less responsible when others are present (Darley & Latane, 1968).' },
  { cat: 'Bio/Biochem', text: 'In the presence of glucose and absence of lactose, the E. coli lac operon is:', choices: ['Repressed — lac repressor bound to operator', 'Active — CAP-cAMP activates transcription', 'Partially active due to allolactose', 'Fully transcribed due to high cAMP'], ans: 0, exp: 'Without lactose, allolactose is absent, lac repressor binds operator, operon is repressed.' },
  { cat: 'Chem/Phys', text: "A galvanic cell's cathode ion concentration is increased tenfold. Cell potential will:", choices: ['Increase — Q decreases, E rises', 'Decrease — Q increases, E falls', 'Stay the same — concentration does not affect E', 'Drop to zero — equilibrium reached'], ans: 0, exp: 'Nernst: E = Eo - (RT/nF)lnQ. Increasing cathode oxidized species decreases Q, increasing E_cell.' },
  { cat: 'Psych/Soc', text: 'Ice cream sales and drowning deaths both peak in summer. This is best described as:', choices: ['Spurious correlation due to confound (season/heat)', 'Direct causation — ice cream causes drowning', 'Reverse causation — drowning promotes ice cream sales', 'Sampling bias in data collection'], ans: 0, exp: 'Confounding variable (summer heat) drives both. Correlation is not causation.' },
  { cat: 'Bio/Biochem', text: 'Pyruvate is converted to acetyl-CoA by PDH. Which cofactor is NOT required?', choices: ['Biotin', 'TPP (thiamine pyrophosphate)', 'CoA', 'NAD+'], ans: 0, exp: 'Biotin is for carboxylation reactions (pyruvate carboxylase), not PDH. PDH requires TPP, lipoate, CoA, FAD, and NAD+.' },
  { cat: 'Chem/Phys', text: 'A reaction: deltaH = +50 kJ and deltaS = +200 J/K. At 400 K, the reaction is:', choices: ['Spontaneous (deltaG < 0)', 'Non-spontaneous (deltaG > 0)', 'At equilibrium (deltaG = 0)', 'Cannot be determined'], ans: 0, exp: 'deltaG = deltaH - T*deltaS = 50000 - 400*200 = -30000 J. Since deltaG < 0, spontaneous at 400K.' },
  { cat: 'Bio/Biochem', text: 'Which finding on Lineweaver-Burk correctly indicates competitive inhibition?', choices: ['Lines intersect on y-axis (same Vmax, higher Km)', 'Lines intersect on x-axis (same Km, lower Vmax)', 'Parallel lines (different Km and Vmax)', 'Lines intersect at origin'], ans: 0, exp: 'Competitive: Vmax unchanged (same y-intercept = 1/Vmax), Km increases (x-intercept shifts). Lines cross on y-axis.' },
  { cat: 'Psych/Soc', text: "Which cognitive ability first appears in Piaget's concrete operational stage?", choices: ['Conservation of volume and number', 'Object permanence', 'Hypothetical-deductive reasoning', 'Symbolic play and egocentrism'], ans: 0, exp: 'Conservation (quantity unchanged despite appearance change) develops in concrete operational stage (7-11 yr). Prior stages lack this.' },
];

const Q_BANK = [];
for (let i = 0; i < 800; i++) Q_BANK.push({ ...Q_TEMPLATES[i % Q_TEMPLATES.length], uid: `q${i}` });

const buildMasteryQuiz = (cat) => {
  const pool = Q_BANK.filter(q => q.cat === cat);
  return [...pool].sort(() => Math.random() - 0.5).slice(0, 5);
};

/* ═══════════════════════════════════════════════════════════════════
   SUPPORT DATA: Portfolio, E-Library, MMI, Schools
═══════════════════════════════════════════════════════════════════ */

const OPPORTUNITIES = [
  { id: 'usabo', name: 'USABO – USA Biology Olympiad', type: 'Competition', deadline: 'January', diff: 'Elite', desc: 'National biology competition for high school students.', url: 'https://www.usabo-trc.org/' },
  { id: 'nih_sip', name: 'NIH Summer Internship Program', type: 'Research', deadline: 'February', diff: 'Competitive', desc: '8-week paid research at NIH Bethesda campus.', url: 'https://www.training.nih.gov/programs/sip' },
  { id: 'simons', name: 'Simons Summer Research Program', type: 'Research', deadline: 'January', diff: 'Competitive', desc: '7-week research at Stony Brook with $3,000 stipend.', url: 'https://www.simonsfoundation.org/' },
  { id: 'hosa', name: 'HOSA Future Health Professionals', type: 'Competition', deadline: 'Varies', diff: 'Open', desc: 'Compete in 60+ healthcare categories.', url: 'https://hosa.org/' },
  { id: 'amsa', name: 'AMSA Premed Scholarship', type: 'Scholarship', deadline: 'May', diff: 'Competitive', desc: 'American Medical Student Association annual awards.', url: 'https://www.amsa.org/' },
  { id: 'rsna', name: 'RSNA Medical Student Symposium', type: 'Conference', deadline: 'October', diff: 'Open', desc: 'Annual radiology conference, free student registration.', url: 'https://www.rsna.org/' },
  { id: 'shadowing', name: 'Clinical Shadowing (100+ hrs)', type: 'Clinical', deadline: 'Ongoing', diff: 'Open', desc: 'Shadow physicians in your target specialty. Required for most medical school applications.', url: '#' },
  { id: 'volunteering', name: 'Hospital / Free Clinic Volunteering', type: 'Volunteering', deadline: 'Ongoing', diff: 'Open', desc: 'Direct patient contact. Shows service orientation.', url: '#' },
];

const ELIB = [
  { cat: 'Bio/Biochem', title: 'Khan Academy – Biomolecules', url: 'https://www.khanacademy.org/test-prep/mcat/biomolecules', type: 'Video Series', free: true, desc: 'Complete coverage of proteins, enzymes, metabolism, and cell biology.' },
  { cat: 'Bio/Biochem', title: 'Khan Academy – Organ Systems', url: 'https://www.khanacademy.org/test-prep/mcat/organ-systems', type: 'Video Series', free: true, desc: 'Cardiovascular, respiratory, renal, immune, endocrine systems.' },
  { cat: 'Bio/Biochem', title: 'Crash Course Biology', url: 'https://www.youtube.com/playlist?list=PL3EED4C1D684D3ADF', type: 'YouTube', free: true, desc: 'Fast-paced visual biology covering all MCAT Bio content.' },
  { cat: 'Chem/Phys', title: 'Khan Academy – Physical Processes', url: 'https://www.khanacademy.org/test-prep/mcat/physical-processes', type: 'Video Series', free: true, desc: 'Physics and general chemistry for the MCAT.' },
  { cat: 'Chem/Phys', title: 'Professor Dave – Organic Chemistry', url: 'https://www.youtube.com/@ProfessorDaveExplains', type: 'YouTube', free: true, desc: 'Clear, detailed organic chemistry mechanism walkthroughs.' },
  { cat: 'Chem/Phys', title: 'The Organic Chemistry Tutor', url: 'https://www.youtube.com/@TheOrganicChemistryTutor', type: 'YouTube', free: true, desc: 'Massive library of worked chemistry problems for the MCAT.' },
  { cat: 'Psych/Soc', title: 'Khan Academy – Psychological Sciences', url: 'https://www.khanacademy.org/test-prep/mcat/social-sciences', type: 'Video Series', free: true, desc: 'All MCAT Psych/Soc topics covered systematically.' },
  { cat: 'Psych/Soc', title: 'Crash Course Psychology', url: 'https://www.youtube.com/playlist?list=PL8dPuuaLjXtOPRKzVLY0jT3gy-7NFgCnz', type: 'YouTube', free: true, desc: 'Comprehensive psychology series from Hank Green.' },
  { cat: 'All', title: 'Anki MCAT Decks (Top-Rated)', url: 'https://www.ankiweb.net/', type: 'Flashcards', free: true, desc: 'Community MCAT decks for spaced-repetition review.' },
  { cat: 'All', title: 'AAMC Official Full-Length Practice Exams', url: 'https://www.aamc.org/students/applying/mcat/preparing/', type: 'Practice Exams', free: false, desc: 'The gold standard — most predictive of actual MCAT score.' },
];

const MMI_QS = [
  { q: "A patient refuses a life-saving blood transfusion on religious grounds. They are conscious and competent. What do you do?", type: 'Ethics' },
  { q: 'Tell me about a significant failure or setback. What did you learn?', type: 'Personal' },
  { q: 'How would you address healthcare disparities in underserved communities?', type: 'Policy' },
  { q: 'A colleague appears impaired during a hospital shift. How do you handle this?', type: 'Professionalism' },
  { q: 'Why do you want to be a physician rather than a nurse practitioner or PA?', type: 'Motivation' },
  { q: 'Describe a time you advocated for someone. What was the outcome?', type: 'Leadership' },
  { q: 'How would you care for a patient who distrusts Western medicine?', type: 'Cultural Competency' },
  { q: 'What does it mean to be a good doctor in 2025?', type: 'Reflection' },
  { q: "A 17-year-old patient asks you not to share her diagnosis with her parents. What do you do?", type: 'Ethics' },
  { q: 'Describe your greatest non-academic achievement and its impact on others.', type: 'Personal' },
  { q: 'Healthcare costs in the US are highest in the world but outcomes lag. What is the root cause?', type: 'Healthcare Systems' },
  { q: 'A patient with terminal cancer asks what you would do in their situation. How do you respond?', type: 'End-of-Life' },
];

const SCHOOL_DATA = [
  { name: 'Johns Hopkins', avgGPA: 3.94, avgMCAT: 523, acceptRate: 6 },
  { name: 'Harvard Medical', avgGPA: 3.93, avgMCAT: 522, acceptRate: 3 },
  { name: 'Stanford Medicine', avgGPA: 3.82, avgMCAT: 520, acceptRate: 2 },
  { name: 'Mayo Clinic School', avgGPA: 3.91, avgMCAT: 520, acceptRate: 2 },
  { name: 'Penn (Perelman)', avgGPA: 3.90, avgMCAT: 522, acceptRate: 4 },
  { name: 'Columbia (VP&S)', avgGPA: 3.86, avgMCAT: 522, acceptRate: 4 },
  { name: 'Duke School of Medicine', avgGPA: 3.84, avgMCAT: 521, acceptRate: 4 },
  { name: 'Vanderbilt Medical', avgGPA: 3.86, avgMCAT: 521, acceptRate: 5 },
  { name: 'UCSF Medicine', avgGPA: 3.82, avgMCAT: 517, acceptRate: 3 },
  { name: 'UT Southwestern', avgGPA: 3.89, avgMCAT: 519, acceptRate: 7 },
  { name: 'Michigan Medicine', avgGPA: 3.86, avgMCAT: 517, acceptRate: 7 },
  { name: 'Emory School of Medicine', avgGPA: 3.75, avgMCAT: 516, acceptRate: 8 },
  { name: 'Boston University Medicine', avgGPA: 3.71, avgMCAT: 515, acceptRate: 4 },
  { name: 'Georgetown Medicine', avgGPA: 3.63, avgMCAT: 511, acceptRate: 4 },
  { name: 'Temple (Katz)', avgGPA: 3.58, avgMCAT: 511, acceptRate: 7 },
];

/* ═══════════════════════════════════════════════════════════════════
   COMPONENT: MasteryDot — KA-style ○ ◐ ● ★
═══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════
   COMPONENT: MasteryDot
   Renders the KA-style ○ ◐ ● ★ mastery level indicator.
═══════════════════════════════════════════════════════════════════ */
const MasteryDot = memo(({ level = 0, size = 22, animate = false }) => {
  const m = MASTERY[Math.min(Math.max(level, 0), 3)];
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-bold flex-shrink-0 transition-all duration-300 ${animate ? 'level-up' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.52, background: m.bg, border: `1.5px solid ${m.border}`, color: m.color }}
      title={`${m.label} (${level}/3)`}
    >
      {m.dot}
    </span>
  );
});
MasteryDot.displayName = 'MasteryDot';

/* ═══════════════════════════════════════════════════════════════════
   COMPONENT: CircularProgress
   SVG ring showing mastery/course % like KA's unit overview.
═══════════════════════════════════════════════════════════════════ */
const CircularProgress = memo(({ pct = 0, accent = '#3b82f6', size = 72, showLabel = true }) => {
  const stroke = size < 50 ? 4.5 : size < 65 ? 5.5 : 7;
  const r      = (size - stroke * 2) / 2;
  const circ   = 2 * Math.PI * r;
  const clamped = Math.min(Math.max(pct, 0), 100);
  const dash   = (clamped / 100) * circ;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={clamped >= 100 ? '#10b981' : accent}
          strokeWidth={stroke} strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.75s cubic-bezier(0.4,0,0.2,1)' }} />
      </svg>
      {showLabel && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-black leading-none" style={{ color: clamped >= 100 ? '#10b981' : 'rgba(255,255,255,0.85)', fontSize: size * 0.22 }}>
            {clamped}%
          </span>
        </div>
      )}
    </div>
  );
});
CircularProgress.displayName = 'CircularProgress';

/* ═══════════════════════════════════════════════════════════════════
   COMPONENT: MasteryProgress
   Horizontal bar showing progress toward next mastery level.
   Used inside lesson practice results.
═══════════════════════════════════════════════════════════════════ */
const MasteryProgress = memo(({ level, correctCount }) => {
  const m    = MASTERY[level];
  const pct  = progressToNext(correctCount, level);
  const next = MASTERY[Math.min(level + 1, 3)];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <MasteryDot level={level} size={16} />
          <span style={{ color: m.color }} className="font-bold">{m.label}</span>
        </div>
        {level < 3 && (
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500">Next: </span>
            <MasteryDot level={level + 1} size={16} />
            <span style={{ color: next.color }} className="font-bold">{next.label}</span>
          </div>
        )}
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full rounded-full prog-fill" style={{ width: `${pct}%`, background: m.color }} />
      </div>
      {level < 3 && (
        <p className="text-[10px] text-gray-600">
          {correctCount} / {nextThreshold(level)} correct answers to reach {next.label}
        </p>
      )}
    </div>
  );
});
MasteryProgress.displayName = 'MasteryProgress';

/* ═══════════════════════════════════════════════════════════════════
   COMPONENT: QuizEngine
   Shared engine for mastery checks AND quiz library.
   Fixed: displayName added, answer letter icons show ✓/✗ when confirmed.
═══════════════════════════════════════════════════════════════════ */
const QuizEngine = memo(({ questions, onFinish, title, onBack }) => {
  const [qi,        setQi]    = useState(0);
  const [sel,       setSel]   = useState(null);
  const [confirmed, setConf]  = useState(false);
  const [score,     setScore] = useState(0);
  const LETTERS = ['A', 'B', 'C', 'D'];
  const q = questions[qi];

  const handleConfirm = useCallback(() => {
    if (sel === null) return;
    setConf(true);
    if (sel === q.ans) setScore(s => s + 1);
  }, [sel, q]);

  const handleNext = useCallback(() => {
    const newScore = score + (sel === q.ans ? 1 : 0);
    if (qi + 1 >= questions.length) {
      onFinish(newScore, questions.length);
    } else {
      setQi(i => i + 1);
      setSel(null);
      setConf(false);
    }
  }, [qi, score, sel, q, questions.length, onFinish]);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-4">
        {onBack && (
          <button onClick={onBack} className="text-gray-500 hover:text-white text-sm transition flex-shrink-0">
            ← Back
          </button>
        )}
        {title && <p className="text-xs font-bold text-blue-400 uppercase tracking-widest flex-1 text-center">{title}</p>}
        <span className="text-xs text-gray-500 flex-shrink-0">{qi + 1} / {questions.length}</span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-white/5 rounded-full h-1.5 mb-6">
        <div className="h-1.5 rounded-full bg-blue-500 prog-fill" style={{ width: `${(qi / questions.length) * 100}%` }} />
      </div>

      <div className="bg-white/5 border border-white/10 rounded-[24px] p-8">
        <div className="flex justify-between items-center mb-5">
          <span className="text-xs text-gray-500">Question {qi + 1} of {questions.length}</span>
          <span className="text-xs font-bold text-blue-400 bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20">{q.cat}</span>
        </div>

        <h2 className="text-xl font-bold text-white mb-8 leading-snug"><MixedText t={q.text} /></h2>

        <div className="grid gap-3 mb-8">
          {q.choices.map((c, i) => {
            let cls = 'flex items-start gap-4 p-4 rounded-2xl border text-left transition-all duration-150 w-full cursor-pointer ';
            if (confirmed) {
              if (i === q.ans) cls += 'bg-emerald-500/10 border-emerald-400/50 text-emerald-200';
              else if (i === sel) cls += 'bg-red-500/10 border-red-400/50 text-red-300';
              else cls += 'bg-transparent border-white/5 text-gray-600 cursor-default';
            } else {
              cls += sel === i
                ? 'bg-blue-600/20 border-blue-500 text-white'
                : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10 hover:border-white/25';
            }
            const letterBg =
              confirmed && i === q.ans ? 'bg-emerald-500 text-white' :
              confirmed && i === sel   ? 'bg-red-500 text-white' :
              sel === i && !confirmed  ? 'bg-blue-500 text-white' :
              'bg-white/10 text-gray-400';
            return (
              <button key={i} disabled={confirmed} onClick={() => setSel(i)} className={cls}>
                <span className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-xs font-black mt-0.5 transition-colors ${letterBg}`}>
                  {confirmed && i === q.ans ? '✓' : confirmed && i === sel ? '✗' : LETTERS[i]}
                </span>
                <span className="text-sm leading-relaxed"><MixedText t={c} /></span>
              </button>
            );
          })}
        </div>

        {/* Explanation panel */}
        {confirmed && (
          <div className="slide-in p-5 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl mb-6">
            <p className="text-xs font-bold text-emerald-400 mb-2">Explanation</p>
            <p className="text-sm text-gray-300 leading-relaxed"><MixedText t={q.exp} /></p>
          </div>
        )}

        {!confirmed
          ? <button onClick={handleConfirm} disabled={sel === null}
              className="w-full py-4 bg-white text-black font-black rounded-xl hover:bg-blue-50 transition disabled:opacity-30 disabled:cursor-not-allowed">
              Confirm Answer
            </button>
          : <button onClick={handleNext}
              className="w-full py-4 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-500 transition">
              {qi + 1 >= questions.length ? 'See Results →' : 'Next Question →'}
            </button>
        }
      </div>
    </div>
  );
});
QuizEngine.displayName = 'QuizEngine';

/* ═══════════════════════════════════════════════════════════════════
   COMPONENT: LessonPractice
   
   Khan Academy–style per-lesson practice engine.
   5 questions per session, shows mastery level advancement.
   
   FIXED:
   • correctCount now cumulates across sessions (not reset each time)
   • markArticleRead no longer bumps correctCount (was a bug)
   • Mastery thresholds now correct for 5-question sessions
═══════════════════════════════════════════════════════════════════ */
const LessonPractice = memo(({ lesson, unit, currentCorrectCount, onFinish, onBack }) => {
  const [qi,        setQi]    = useState(0);
  const [sel,       setSel]   = useState(null);
  const [confirmed, setConf]  = useState(false);
  const [correct,   setCorr]  = useState(0);
  const [showResult, setShowResult] = useState(false);
  const LETTERS = ['A', 'B', 'C', 'D'];

  // Build a fresh set of 5 questions for this session
  const questions = useRef((() => {
    const pool = [];
    for (let i = 0; i < 800; i++) {
      const tpl = [
        { cat: 'Chem/Phys', text: 'A fluid flows through a tube. Pressure gradient tripled, radius halved. New flow rate vs original:', choices: ['3/16 of original', '3/8 of original', '3/4 of original', '6× original'], ans: 0, exp: "Poiseuille: Q ∝ r⁴ΔP. New Q = Q₀ × 3 × (½)⁴ = 3/16 Q₀." },
        { cat: 'Bio/Biochem', text: 'Competitive inhibitor added to enzyme reaction. Effect on Km and Vmax?', choices: ['Km ↑; Vmax unchanged', 'Vmax ↓; Km unchanged', 'Both Km and Vmax ↑', 'Neither changes'], ans: 0, exp: 'Competitive inhibitors raise apparent Km (overcome with substrate excess) but leave Vmax unchanged.' },
        { cat: 'Bio/Biochem', text: "Direct energy currency for myosin's power stroke?", choices: ['ATP', 'NADH', 'Creatine phosphate', 'GTP'], ans: 0, exp: 'Myosin ATPase directly hydrolyzes ATP to power the conformational change of the power stroke.' },
        { cat: 'Chem/Phys', text: 'Light from water (n=1.33) into glass (n=1.50) at 45°. Refracted ray:', choices: ['Bends toward normal (angle < 45°)', 'Bends away from normal (angle > 45°)', 'Passes straight through', 'Total internal reflection'], ans: 0, exp: "Snell: n₁sinθ₁ = n₂sinθ₂. n₂ > n₁ → sinθ₂ < sinθ₁ → bends toward normal." },
        { cat: 'Psych/Soc', text: 'Bystanders see others not helping and also refrain. Best explanation:', choices: ['Diffusion of responsibility', 'Fundamental attribution error', 'In-group bias', 'Cognitive dissonance'], ans: 0, exp: 'Bystander effect: each person feels less responsible when others are present (Darley & Latané, 1968).' },
        { cat: 'Bio/Biochem', text: 'Glucose present, no lactose: E. coli lac operon is:', choices: ['Repressed — repressor bound to operator', 'Active — CAP-cAMP activates', 'Partially active via allolactose', 'Fully transcribed (high cAMP)'], ans: 0, exp: 'No allolactose → lac repressor remains bound to operator → operon repressed.' },
        { cat: 'Chem/Phys', text: "Galvanic cell cathode ion concentration ×10. Cell potential will:", choices: ['Increase — Q ↓, E ↑', 'Decrease — Q ↑, E ↓', 'Unchanged', 'Drop to zero'], ans: 0, exp: 'Nernst: E = E° – (RT/nF)lnQ. More cathode oxidant → ↓Q → ↑E.' },
        { cat: 'Psych/Soc', text: 'Ice cream sales and drowning both peak in summer. Best description:', choices: ['Spurious correlation (confound: heat)', 'Ice cream causes drowning', 'Reverse causation', 'Sampling bias'], ans: 0, exp: 'Confounding variable (summer heat) drives both. Correlation ≠ causation.' },
        { cat: 'Bio/Biochem', text: 'PDH converts pyruvate → acetyl-CoA. Which cofactor is NOT required?', choices: ['Biotin', 'TPP', 'CoA', 'NAD⁺'], ans: 0, exp: 'Biotin is for carboxylation reactions (pyruvate carboxylase), NOT PDH. PDH needs TPP, lipoate, CoA, FAD, NAD⁺.' },
        { cat: 'Chem/Phys', text: 'ΔH = +50 kJ, ΔS = +200 J/K. At 400 K, reaction is:', choices: ['Spontaneous (ΔG < 0)', 'Non-spontaneous (ΔG > 0)', 'At equilibrium (ΔG = 0)', 'Cannot determine'], ans: 0, exp: 'ΔG = ΔH − TΔS = 50,000 − 80,000 = −30,000 J. ΔG < 0 → spontaneous.' },
        { cat: 'Bio/Biochem', text: 'Competitive inhibition on Lineweaver-Burk plot:', choices: ['Lines cross on y-axis (same Vmax, higher Km)', 'Lines cross on x-axis (same Km, lower Vmax)', 'Parallel lines', 'Cross at origin'], ans: 0, exp: 'Competitive: Vmax unchanged (same y-intercept), Km rises (x-intercept shifts left). Lines cross on y-axis.' },
        { cat: 'Psych/Soc', text: "Concrete operational stage first enables:", choices: ['Conservation of volume/number', 'Object permanence', 'Hypothetical-deductive reasoning', 'Symbolic play'], ans: 0, exp: 'Conservation develops in concrete operational (7-11 yr). Earlier stages lack this ability.' },
      ][i % 12];
      pool.push({ ...tpl, uid: `lp${i}` });
    }
    const filtered = pool.filter(q => q.cat === unit.cat);
    return [...filtered].sort(() => Math.random() - 0.5).slice(0, 5);
  })()).current;

  const q = questions[qi];

  const handleConfirm = useCallback(() => {
    if (sel === null) return;
    setConf(true);
    if (sel === q.ans) setCorr(c => c + 1);
  }, [sel, q]);

  const handleNext = useCallback(() => {
    const newCorrect = correct + (sel === q.ans ? 1 : 0);
    if (qi + 1 >= questions.length) {
      setShowResult(true);
      setCorr(newCorrect);
    } else {
      setQi(i => i + 1);
      setSel(null);
      setConf(false);
    }
  }, [qi, correct, sel, q, questions.length]);

  if (showResult) {
    const totalCount   = currentCorrectCount + correct;
    const newLevel     = getMasteryLevel(totalCount);
    const prevLevel    = getMasteryLevel(currentCorrectCount);
    const leveledUp    = newLevel > prevLevel;
    const m            = MASTERY[newLevel];
    const pct          = Math.round((correct / questions.length) * 100);
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white/5 border border-white/10 rounded-[24px] p-8 text-center">
          {/* Score */}
          <div className="mb-6">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Practice Complete</p>
            <p className="text-6xl font-black mb-1" style={{ color: pct >= 80 ? '#10b981' : pct >= 60 ? '#3b82f6' : '#f59e0b' }}>
              {correct}/{questions.length}
            </p>
            <p className="text-gray-500 text-sm">{pct}% correct this session</p>
          </div>

          {/* Mastery change */}
          <div className="mb-8 p-5 rounded-2xl border" style={{ background: m.bg, borderColor: m.border }}>
            {leveledUp ? (
              <div className="flex flex-col items-center gap-3">
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <MasteryDot level={prevLevel} size={22} />
                  <span>{MASTERY[prevLevel].label}</span>
                  <span className="text-gray-600">→</span>
                  <MasteryDot level={newLevel} size={22} animate />
                  <span style={{ color: m.color }} className="font-bold">{m.label}</span>
                </div>
                <p className="text-lg font-black" style={{ color: m.color }}>
                  Level Up! You reached {m.label} {m.dot}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <MasteryDot level={newLevel} size={28} />
                <p className="font-bold" style={{ color: m.color }}>{m.label}</p>
              </div>
            )}
          </div>

          {/* Progress toward next level */}
          <div className="mb-8 text-left">
            <MasteryProgress level={newLevel} correctCount={totalCount} />
          </div>

          {/* XP earned */}
          <p className="text-sm text-emerald-400 font-bold mb-6">+{correct * 20} XP earned</p>

          <div className="flex gap-3">
            <button onClick={onBack}
              className="flex-1 py-3 bg-white/10 border border-white/10 rounded-xl font-bold hover:bg-white/20 transition text-sm">
              Back to Lesson
            </button>
            <button onClick={() => onFinish(correct, questions.length, totalCount)}
              className="flex-1 py-3 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-500 transition">
              Continue →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-4">
        <button onClick={onBack} className="text-gray-500 hover:text-white text-sm transition flex-shrink-0">← Back</button>
        <p className="text-xs font-bold text-violet-400 uppercase tracking-widest flex-1 text-center">
          Practice — {lesson.title}
        </p>
        <span className="text-xs text-gray-500 flex-shrink-0">{qi + 1} / {questions.length}</span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-white/5 rounded-full h-1.5 mb-6">
        <div className="h-1.5 rounded-full bg-violet-500 prog-fill" style={{ width: `${(qi / questions.length) * 100}%` }} />
      </div>

      {/* Current session score */}
      <div className="flex items-center justify-between mb-4 px-1">
        <p className="text-xs text-gray-600">Session score: {correct}/{qi} correct</p>
        <div className="flex items-center gap-1.5">
          {questions.map((_, i) => (
            <span key={i} className={`w-2 h-2 rounded-full transition-colors ${i < qi ? (i < qi && questions[i].uid ? 'bg-gray-400' : 'bg-gray-400') : i === qi ? 'bg-violet-500' : 'bg-white/10'}`} />
          ))}
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-[24px] p-8">
        <div className="flex justify-between items-center mb-5">
          <span className="text-xs text-gray-500">Question {qi + 1} of {questions.length}</span>
          <span className="text-xs font-bold text-violet-400 bg-violet-500/10 px-3 py-1 rounded-full border border-violet-500/20">{q.cat}</span>
        </div>

        <h2 className="text-xl font-bold text-white mb-8 leading-snug">{q.text}</h2>

        <div className="grid gap-3 mb-8">
          {q.choices.map((c, i) => {
            let cls = 'flex items-start gap-4 p-4 rounded-2xl border text-left transition-all duration-150 w-full ';
            if (confirmed) {
              if (i === q.ans) cls += 'bg-emerald-500/10 border-emerald-400/50 text-emerald-200';
              else if (i === sel) cls += 'bg-red-500/10 border-red-400/50 text-red-300';
              else cls += 'bg-transparent border-white/5 text-gray-600 cursor-default';
            } else {
              cls += sel === i ? 'bg-violet-600/20 border-violet-500 text-white' : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10 hover:border-white/25';
            }
            const letterBg =
              confirmed && i === q.ans ? 'bg-emerald-500 text-white' :
              confirmed && i === sel   ? 'bg-red-500 text-white' :
              sel === i && !confirmed  ? 'bg-violet-500 text-white' :
              'bg-white/10 text-gray-400';
            return (
              <button key={i} disabled={confirmed} onClick={() => setSel(i)} className={cls}>
                <span className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-xs font-black mt-0.5 ${letterBg}`}>
                  {confirmed && i === q.ans ? '✓' : confirmed && i === sel ? '✗' : ['A','B','C','D'][i]}
                </span>
                <span className="text-sm leading-relaxed">{c}</span>
              </button>
            );
          })}
        </div>

        {confirmed && (
          <div className="slide-in p-5 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl mb-6">
            <p className="text-xs font-bold text-emerald-400 mb-2">Explanation</p>
            <p className="text-sm text-gray-300 leading-relaxed">{q.exp}</p>
          </div>
        )}

        {!confirmed
          ? <button onClick={handleConfirm} disabled={sel === null}
              className="w-full py-4 bg-white text-black font-black rounded-xl hover:bg-violet-50 transition disabled:opacity-30 disabled:cursor-not-allowed">
              Confirm Answer
            </button>
          : <button onClick={handleNext}
              className="w-full py-4 bg-violet-600 text-white font-black rounded-xl hover:bg-violet-500 transition">
              {qi + 1 >= questions.length ? 'Finish Practice →' : 'Next Question →'}
            </button>
        }
      </div>
    </div>
  );
});
LessonPractice.displayName = 'LessonPractice';

/* ═══════════════════════════════════════════════════════════════════
   COMPONENT: PortfolioAdder
═══════════════════════════════════════════════════════════════════ */
function PortfolioAdder({ onAdd }) {
  const [title, setTitle] = useState('');
  const [type,  setType]  = useState('Research');
  const [date,  setDate]  = useState('');
  const types = ['Research', 'Clinical', 'Volunteering', 'Competition', 'Scholarship', 'Conference', 'Leadership', 'Other'];
  const submit = () => {
    if (!title.trim()) return;
    onAdd({ title, type, date: date || 'Ongoing' });
    setTitle(''); setDate('');
  };
  return (
    <div className="bg-white/5 border border-dashed border-white/20 rounded-2xl p-4">
      <p className="text-xs font-bold text-gray-500 mb-3 uppercase tracking-widest">Add Activity</p>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Activity name..."
        className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-blue-500/40 text-gray-200 placeholder:text-gray-700 mb-2" />
      <div className="flex gap-2 mb-3">
        <select value={type} onChange={e => setType(e.target.value)} className="flex-1 bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-sm text-gray-400 outline-none">
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="month" value={date} onChange={e => setDate(e.target.value)} className="flex-1 bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-sm text-gray-400 outline-none" />
      </div>
      <button onClick={submit} className="w-full py-2 bg-white/10 rounded-xl text-xs font-bold hover:bg-white/20 transition">+ Add to Timeline</button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN APP COMPONENT
═══════════════════════════════════════════════════════════════════ */
export default function App() {

  /* ─── Global State ─── */
  const [tab, setTab] = useState('home');
  const [user, setUser] = useState(() => {
    const stored = storage.get('msp_user', { name: '', specialty: null, xp: 0, streak: 0, lastActive: null });
    if (!stored.name) {
      try { const s = JSON.parse(localStorage.getItem('msp_session') || 'null'); if (s?.name) stored.name = s.name; } catch {}
    }
    return stored;
  });
  const [pathway, setPathway]     = useState(() => storage.get('msp_pathway', {}));
  const [flashDecks, setFlashDecks] = useState(() => storage.get('msp_flash', {}));
  const [portfolio, setPortfolio] = useState(() => storage.get('msp_port', []));
  const [catPerf, setCatPerf]     = useState(() => storage.get('msp_catperf', {}));

  /* ─── Pathway Navigation State ─── */
  // activeLessonView: { unit, lesson, step: 'video'|'article'|'practice' }
  const [activeLessonView,   setActiveLessonView]   = useState(null);
  const [lessonPracticeMode, setLessonPracticeMode] = useState(false);
  const [activeUnit,         setActiveUnit]         = useState(null); // { unit, mode: 'mastery' }
  const [activeMasteryQs,    setActiveMasteryQs]    = useState(null);
  const [quizResults,        setQuizResults]        = useState(null);
  const [practiceMode,       setPracticeMode]       = useState(null); // 'lesson' | 'personalized'

  /* ─── Diagnostic ─── */
  const [diagStep,     setDiagStep]     = useState(0);
  const [diagAnswers,  setDiagAnswers]  = useState({});
  const [diagDone,     setDiagDone]     = useState(false);

  /* ─── AI Coach ─── */
  const [msgs,        setMsgs]       = useState([{ role: 'assistant', content: "Hello! I'm MetaBrain, your dedicated MCAT coach. Ask me anything — from enzyme kinetics to MMI interview prep. What shall we tackle today?" }]);
  const [chatInput,   setChatInput]  = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const msgsEndRef = useRef(null);

  /* ─── Flashcards ─── */
  const [flashInput,   setFlashInput]   = useState('');
  const [flashLoading, setFlashLoading] = useState(false);
  const [activeDeck,   setActiveDeck]   = useState(null);
  const [cardIdx,      setCardIdx]      = useState(0);
  const [cardFlipped,  setCardFlipped]  = useState(false);

  /* ─── E-Library ─── */
  const [libSearch, setLibSearch] = useState('');
  const [libCat,    setLibCat]    = useState('All');

  /* ─── Interview ─── */
  const [interviewQ,        setInterviewQ]        = useState(null);
  const [interviewAnswer,   setInterviewAnswer]   = useState('');
  const [interviewFeedback, setInterviewFeedback] = useState('');
  const [interviewLoading,  setInterviewLoading]  = useState(false);
  const [interviewType,     setInterviewType]     = useState('All');

  /* ─── Admissions ─── */
  const [gpa,          setGpa]          = useState('');
  const [mcat,         setMcat]         = useState('');
  const [clinicalHrs,  setClinicalHrs]  = useState('');
  const [volunteerHrs, setVolunteerHrs] = useState('');
  const [hasResearch,  setHasResearch]  = useState(false);
  const [calcResults,  setCalcResults]  = useState(null);

  /* ─── Quiz Library ─── */
  const [quizLibCat,   setQuizLibCat]  = useState('All');
  const [activeLibQuiz, setActiveLibQuiz] = useState(null);

  /* ─── Settings ─── */
  const [settingsName,  setSettingsName]  = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);

  /* ─── Pomodoro ─── */
  const [pomodoroActive,   setPomodoroActive]   = useState(false);
  const [pomodoroTimeLeft, setPomodoroTimeLeft] = useState(25 * 60);
  const [onBreak,          setOnBreak]          = useState(false);
  const pomodoroRef = useRef(null);

  /* ─── Persistence ─── */
  useEffect(() => { storage.set('msp_user',    user);       }, [user]);
  useEffect(() => { storage.set('msp_pathway', pathway);    }, [pathway]);
  useEffect(() => { storage.set('msp_flash',   flashDecks); }, [flashDecks]);
  useEffect(() => { storage.set('msp_port',    portfolio);  }, [portfolio]);
  useEffect(() => { storage.set('msp_catperf', catPerf);    }, [catPerf]);
  useEffect(() => { msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  /* ─── Daily Streak ─── */
  useEffect(() => {
    const today     = new Date().toDateString();
    if (user.lastActive === today) return;
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    setUser(u => ({ ...u, streak: u.lastActive === yesterday ? (u.streak || 0) + 1 : 1, lastActive: today }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── Pomodoro Timer ─── */
  useEffect(() => {
    if (pomodoroActive) {
      pomodoroRef.current = setInterval(() => {
        setPomodoroTimeLeft(t => {
          if (t <= 1) { clearInterval(pomodoroRef.current); setPomodoroActive(false); setOnBreak(b => !b); return onBreak ? 25 * 60 : 5 * 60; }
          return t - 1;
        });
      }, 1000);
    }
    return () => clearInterval(pomodoroRef.current);
  }, [pomodoroActive, onBreak]);

  const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  /* ─── Navigation ─── */
  const navTo = useCallback((id) => {
    setTab(id);
    setActiveLessonView(null); setLessonPracticeMode(false);
    setActiveUnit(null); setActiveMasteryQs(null); setQuizResults(null);
    setPracticeMode(null);
  }, []);

  /* ─── Sign Out — FIXED: now redirects to LANDING_URL ─── */
  const signOut = useCallback(() => {
    ['msp_session', 'msp_user', 'msp_pathway', 'msp_flash', 'msp_port', 'msp_catperf']
      .forEach(k => localStorage.removeItem(k));
    window.location.replace(LANDING_URL);
  }, []);

  /* ═══════════════════════════════════════════════════
     DIAGNOSTIC LOGIC
  ═══════════════════════════════════════════════════ */
  const handleDiagAnswer = (qIdx, optIdx) => {
    const newAnswers = { ...diagAnswers, [qIdx]: optIdx };
    setDiagAnswers(newAnswers);
    if (qIdx + 1 >= DIAGNOSTIC_QS.length) {
      const scores = { surgery: 0, internal: 0, pediatrics: 0, psychiatry: 0, research: 0 };
      Object.entries(newAnswers).forEach(([qi, oi]) => {
        const wq = DIAGNOSTIC_QS[parseInt(qi)];
        Object.keys(scores).forEach(sp => { scores[sp] += wq.w[sp][oi] || 0; });
      });
      const specialty = Object.entries(scores).sort(([, a], [, b]) => b - a)[0][0];
      setUser(u => ({ ...u, specialty, xp: u.xp + 100 }));
      const initPathway = {};
      PATHS[specialty].units.forEach((u, i) => {
        initPathway[u.id] = { unlocked: i === 0, masteryScore: null, lessons: {} };
      });
      setPathway(initPathway);
      setDiagDone(true);
    } else {
      setDiagStep(qIdx + 1);
    }
  };

  /* ═══════════════════════════════════════════════════
     KHAN ACADEMY PATHWAY LOGIC
  ═══════════════════════════════════════════════════ */
  const currentPath = user.specialty ? PATHS[user.specialty] : null;

  /* Mark video watched — gives +10 XP */
  const markVideoWatched = useCallback((unitId, lessonId) => {
    setPathway(prev => setLessonState(prev, unitId, lessonId, s => ({ ...s, videoWatched: true })));
    setUser(u => ({ ...u, xp: u.xp + 10 }));
  }, []);

  /* Mark article read — gives +15 XP.
     FIXED: does NOT bump correctCount (that corrupted mastery levels). */
  const markArticleRead = useCallback((unitId, lessonId) => {
    setPathway(prev => setLessonState(prev, unitId, lessonId, s => ({ ...s, articleRead: true })));
    setUser(u => ({ ...u, xp: u.xp + 15 }));
  }, []);

  /* Complete a practice session.
     FIXED: correctCount accumulates correctly across sessions.
     FIXED: mastery thresholds now match 5-question sessions. */
  const completeLessonPractice = useCallback((unitId, lessonId, correct, _total, totalCount) => {
    setPathway(prev => {
      return setLessonState(prev, unitId, lessonId, s => ({
        ...s,
        correctCount: totalCount,
        masteryLevel: getMasteryLevel(totalCount),
        sessions: (s.sessions || 0) + 1,
      }));
    });
    setUser(u => ({ ...u, xp: u.xp + correct * 20 }));
    // Update category performance
    const unit = currentPath?.units.find(u => u.lessons.some(l => l.id === lessonId));
    if (unit) {
      const pct = _total > 0 ? Math.round((correct / _total) * 100) : 0;
      setCatPerf(prev => {
        const c = prev[unit.cat] || { total: 0, count: 0 };
        return { ...prev, [unit.cat]: { total: c.total + pct, count: c.count + 1, last: pct } };
      });
    }
  }, [currentPath]);

  /* Start a unit mastery check */
  const startMasteryCheck = useCallback((unit) => {
    // Build an 8-question check spanning the unit's category
    const pool = [];
    for (let i = 0; i < 800; i++) {
      const tpl = [
        { cat: 'Chem/Phys', text: 'A fluid flows through a tube. Pressure gradient tripled, radius halved. New flow rate?', choices: ['3/16 of original', '3/8 of original', '3/4 of original', '6× original'], ans: 0, exp: "Poiseuille: Q ∝ r⁴ΔP. New Q = 3 × (½)⁴ = 3/16 Q₀." },
        { cat: 'Bio/Biochem', text: 'Competitive inhibitor: effect on Km and Vmax?', choices: ['Km ↑; Vmax unchanged', 'Vmax ↓; Km unchanged', 'Both ↑', 'Neither changes'], ans: 0, exp: 'Competitive inhibitors raise apparent Km but Vmax is unchanged.' },
        { cat: 'Bio/Biochem', text: "Direct energy for myosin's power stroke?", choices: ['ATP', 'NADH', 'Creatine phosphate', 'GTP'], ans: 0, exp: 'Myosin ATPase directly hydrolyzes ATP.' },
        { cat: 'Chem/Phys', text: 'Light water (n=1.33) → glass (n=1.50) at 45°. Result:', choices: ['Bends toward normal', 'Bends away from normal', 'Straight through', 'Total internal reflection'], ans: 0, exp: "n₂ > n₁ → sinθ₂ < sinθ₁ → bends toward normal." },
        { cat: 'Psych/Soc', text: 'Bystanders see others not helping and refrain. Best explanation:', choices: ['Diffusion of responsibility', 'FAE', 'In-group bias', 'Cognitive dissonance'], ans: 0, exp: 'Bystander effect: diffusion of responsibility.' },
        { cat: 'Bio/Biochem', text: 'PDH cofactor NOT required:', choices: ['Biotin', 'TPP', 'CoA', 'NAD⁺'], ans: 0, exp: 'Biotin is for carboxylation (pyruvate carboxylase), not PDH.' },
        { cat: 'Chem/Phys', text: 'ΔH = +50 kJ, ΔS = +200 J/K, T = 400 K. Reaction is:', choices: ['Spontaneous', 'Non-spontaneous', 'At equilibrium', 'Cannot determine'], ans: 0, exp: 'ΔG = 50,000 − 80,000 = −30,000 J < 0. Spontaneous.' },
        { cat: 'Psych/Soc', text: 'Ice cream sales and drowning deaths peak together in summer:', choices: ['Spurious correlation (confound: heat)', 'Causation', 'Reverse causation', 'Sampling bias'], ans: 0, exp: 'Confounding variable (summer heat) drives both.' },
        { cat: 'Bio/Biochem', text: 'Lac operon: glucose present, no lactose:', choices: ['Repressed', 'Active (CAP-cAMP)', 'Partially active', 'Fully transcribed'], ans: 0, exp: 'No allolactose → repressor bound → operon off.' },
        { cat: 'Chem/Phys', text: 'Cathode ion concentration ×10. Cell potential:', choices: ['Increases', 'Decreases', 'Unchanged', 'Drops to zero'], ans: 0, exp: 'More cathode oxidant → ↓Q → ↑E (Nernst).' },
        { cat: 'Bio/Biochem', text: 'Lineweaver-Burk lines cross on y-axis indicates:', choices: ['Competitive inhibition', 'Non-competitive inhibition', 'Uncompetitive inhibition', 'No inhibition'], ans: 0, exp: 'Competitive: same Vmax (y-axis), higher Km (x-axis shifts).' },
        { cat: 'Psych/Soc', text: 'Concrete operational stage first enables:', choices: ['Conservation', 'Object permanence', 'Abstract reasoning', 'Symbolic play'], ans: 0, exp: 'Conservation (7-11 yr) appears in concrete operational stage.' },
      ][i % 12];
      pool.push({ ...tpl, uid: `mc${i}` });
    }
    const filtered = pool.filter(q => q.cat === unit.cat);
    const qs = [...filtered].sort(() => Math.random() - 0.5).slice(0, 8);
    setActiveMasteryQs(qs);
    setActiveUnit({ unit, mode: 'mastery' });
    setActiveLessonView(null);
    setLessonPracticeMode(false);
  }, []);

  /* Finish mastery check */
  const finishMasteryCheck = useCallback((score, total, unit) => {
    const passed = score >= unit.req;
    setQuizResults({ score, total, passed, unit });
    setPathway(prev => {
      const up = { ...prev, [unit.id]: { ...(prev[unit.id] || {}), masteryScore: score } };
      if (passed && currentPath) {
        const units = currentPath.units;
        const idx   = units.findIndex(u => u.id === unit.id);
        if (idx + 1 < units.length) {
          up[units[idx + 1].id] = {
            ...(up[units[idx + 1].id] || {}),
            unlocked: true,
            lessons: up[units[idx + 1].id]?.lessons || {},
          };
        }
      }
      return up;
    });
    setUser(u => ({ ...u, xp: u.xp + (passed ? unit.xp : Math.floor(unit.xp * 0.3)) }));
    if (currentPath) {
      const pct = Math.round((score / total) * 100);
      setCatPerf(prev => {
        const c = prev[unit.cat] || { total: 0, count: 0 };
        return { ...prev, [unit.cat]: { total: c.total + pct, count: c.count + 1, last: pct } };
      });
    }
    setActiveUnit(null);
    setActiveMasteryQs(null);
  }, [currentPath]);

  /* ═══════════════════════════════════════════════════
     AI HELPERS
  ═══════════════════════════════════════════════════ */
  const callAI = async (sys, msg) => {
    const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system: sys, message: msg }) });
    if (!res.ok) throw new Error('API error');
    return (await res.json()).content || 'No response.';
  };

  const sendChat = useCallback(async () => {
    if (!chatInput.trim() || chatLoading) return;
    const newMsgs = [...msgs, { role: 'user', content: chatInput }];
    setMsgs(newMsgs); setChatInput(''); setChatLoading(true);
    const ctx = user.specialty ? `Student is on the ${PATHS[user.specialty]?.label} pathway with ${user.xp} XP.` : '';
    try {
      const reply = await callAI(`You are MetaBrain, an elite MCAT coach. Be concise, high-yield, use mnemonics. ${ctx}`, chatInput);
      setMsgs([...newMsgs, { role: 'assistant', content: reply }]);
    } catch {
      setMsgs([...newMsgs, { role: 'assistant', content: '⚠️ Could not reach the AI. Check that ANTHROPIC_API_KEY is set in your Vercel dashboard.' }]);
    }
    setChatLoading(false);
  }, [chatInput, chatLoading, msgs, user]);

  const generateFlashcards = async () => {
    if (!flashInput.trim() || flashLoading) return;
    setFlashLoading(true);
    try {
      const reply = await callAI('Return ONLY a JSON array of objects with "front" and "back" keys. No preamble, no markdown. Generate 8-12 cards from the given notes.', flashInput);
      const cards = JSON.parse(reply.replace(/```json|```/g, '').trim());
      const name = `Deck ${Object.keys(flashDecks).length + 1}`;
      setFlashDecks(p => ({ ...p, [name]: cards }));
      setActiveDeck(name); setCardIdx(0); setCardFlipped(false); setFlashInput('');
    } catch { alert('Could not generate flashcards. Check your /api/ai endpoint.'); }
    setFlashLoading(false);
  };

  const getInterviewFeedback = async () => {
    if (!interviewAnswer.trim() || interviewLoading) return;
    setInterviewLoading(true);
    try {
      const fb = await callAI('You are an expert MMI interview coach. Give structured feedback: STRENGTHS, AREAS TO IMPROVE, and a SCORE /10. Be honest but encouraging.', `Question: "${interviewQ.q}"\n\nCandidate answer: "${interviewAnswer}"`);
      setInterviewFeedback(fb);
    } catch { setInterviewFeedback('⚠️ Could not get AI feedback. Check your ANTHROPIC_API_KEY.'); }
    setInterviewLoading(false);
  };

  const calcAdmissions = () => {
    const g = parseFloat(gpa), m = parseInt(mcat);
    if (!g || !m || g < 2 || g > 4.0 || m < 472 || m > 528) return alert('Enter valid GPA (2.0–4.0) and MCAT (472–528)');
    const clin = parseInt(clinicalHrs) || 0, vol = parseInt(volunteerHrs) || 0;
    const results = SCHOOL_DATA.map(school => {
      const gGap = school.avgGPA - g, mGap = school.avgMCAT - m;
      let score = 0;
      if (gGap <= -0.2 && mGap <= -4) score = 3;
      else if (gGap <= -0.1 && mGap <= -2) score = 2;
      else if (gGap <= 0.1 && mGap <= 2) score = 1;
      if (clin >= 1000) score += 0.5;
      if (vol >= 200) score += 0.3;
      if (hasResearch) score += 0.3;
      return { ...school, chance: score >= 2.5 ? 'Safety' : score >= 1.5 ? 'Target' : 'Reach', score };
    });
    setCalcResults(results.sort((a, b) => b.score - a.score));
  };

  /* ─── Derived Values ─── */
  const accent         = user.specialty ? PATHS[user.specialty].accent : '#3b82f6';
  const totalXP        = user.xp;
  const xpLevel        = Math.floor(totalXP / 500) + 1;
  const xpProgress     = (totalXP % 500) / 500 * 100;
  const courseMastery  = calcCourseMastery(pathway, currentPath);
  const unitsMastered  = currentPath ? currentPath.units.filter(u => (pathway[u.id]?.masteryScore || 0) >= u.req).length : 0;
  const nextItem       = findNextItem(pathway, currentPath);
  const weakestLessons = findWeakestLessons(pathway, currentPath);
  const filteredLib    = ELIB.filter(r => (libCat === 'All' || r.cat === libCat) && (r.title.toLowerCase().includes(libSearch.toLowerCase()) || r.desc.toLowerCase().includes(libSearch.toLowerCase())));
  const filteredMMI    = interviewType === 'All' ? MMI_QS : MMI_QS.filter(q => q.type === interviewType);
  const libQs          = quizLibCat === 'All' ? (()=>{ const out=[]; for(let i=0;i<800;i++) out.push({...([{cat:'Chem/Phys',text:'A fluid flows through a tube. Pressure gradient tripled, radius halved. New flow rate?',choices:['3/16 of original','3/8 of original','3/4 of original','6× original'],ans:0,exp:"Poiseuille: Q ∝ r⁴ΔP. New Q = 3 × (½)⁴ = 3/16 Q₀."},{cat:'Bio/Biochem',text:'Competitive inhibitor: effect on Km and Vmax?',choices:['Km ↑; Vmax unchanged','Vmax ↓; Km unchanged','Both ↑','Neither'],ans:0,exp:'Competitive inhibitors raise apparent Km; Vmax unchanged.'},{cat:'Bio/Biochem',text:"Direct energy for myosin's power stroke?",choices:['ATP','NADH','Creatine phosphate','GTP'],ans:0,exp:'Myosin ATPase hydrolyzes ATP directly.'},{cat:'Chem/Phys',text:'ΔH=+50kJ, ΔS=+200J/K, T=400K. Reaction:',choices:['Spontaneous','Non-spontaneous','Equilibrium','Cannot determine'],ans:0,exp:'ΔG=−30,000 J < 0. Spontaneous.'},{cat:'Psych/Soc',text:'Bystanders not helping — best explanation:',choices:['Diffusion of responsibility','FAE','In-group bias','Cognitive dissonance'],ans:0,exp:'Bystander effect: diffusion of responsibility.'},{cat:'Bio/Biochem',text:'PDH cofactor NOT required:',choices:['Biotin','TPP','CoA','NAD⁺'],ans:0,exp:'Biotin is for carboxylation reactions, not PDH.'},{cat:'Chem/Phys',text:'Cathode ion ×10. Cell potential:',choices:['Increases','Decreases','Unchanged','Zero'],ans:0,exp:'More oxidant → ↓Q → ↑E.'},{cat:'Psych/Soc',text:'Ice cream & drowning both peak in summer:',choices:['Spurious (confound)','Causation','Reverse causation','Sampling bias'],ans:0,exp:'Confounding variable (summer heat) drives both.'},{cat:'Bio/Biochem',text:'Lac operon: glucose present, no lactose:',choices:['Repressed','Active','Partially active','Fully transcribed'],ans:0,exp:'No allolactose → repressor bound → off.'},{cat:'Chem/Phys',text:'Light water→glass at 45°:',choices:['Bends toward normal','Bends away','Straight','Total internal reflection'],ans:0,exp:'n₂>n₁ → bends toward normal (Snell).'},{cat:'Bio/Biochem',text:'Lineweaver-Burk lines cross on y-axis:',choices:['Competitive inhibition','Non-competitive','Uncompetitive','No inhibition'],ans:0,exp:'Competitive: same Vmax, higher Km.'},{cat:'Psych/Soc',text:'Concrete operational stage first enables:',choices:['Conservation','Object permanence','Abstract reasoning','Symbolic play'],ans:0,exp:'Conservation develops 7-11 yr in concrete operational stage.'}][i%12]),uid:`ql${i}`}); return out; })() : (()=>{ const out=[]; for(let i=0;i<800;i++) { const tpl=[{cat:'Chem/Phys',text:'Pressure ×3, radius ÷2. New flow rate?',choices:['3/16','3/8','3/4','6×'],ans:0,exp:'Poiseuille Q∝r⁴ΔP → 3/16 Q₀.'},{cat:'Bio/Biochem',text:'Competitive inhibitor on Km/Vmax:',choices:['Km↑ Vmax same','Vmax↓ Km same','Both↑','Neither'],ans:0,exp:'Km raises, Vmax unchanged.'},{cat:'Psych/Soc',text:'Bystanders not helping:',choices:['Diffusion of responsibility','FAE','In-group bias','Dissonance'],ans:0,exp:'Bystander effect.'},{cat:'Bio/Biochem',text:'PDH cofactor NOT required:',choices:['Biotin','TPP','CoA','NAD⁺'],ans:0,exp:'Biotin is for carboxylation, not PDH.'},{cat:'Chem/Phys',text:'ΔH=+50kJ ΔS=+200 T=400K:',choices:['Spontaneous','Non-spontaneous','Equilibrium','Cannot determine'],ans:0,exp:'ΔG=−30000J spontaneous.'}][i%5]; if(tpl.cat===quizLibCat) out.push({...tpl,uid:`ql${i}`}); } return out; })();

  const NAV = [
    { id: 'home',       label: 'Home' },
    { id: 'diagnostic', label: 'Pathway Diagnostic' },
    { id: 'pathway',    label: 'Learning Pathway' },
    { id: 'quiz',       label: 'Quiz Library' },
    { id: 'coach',      label: 'MetaBrain AI' },
    { id: 'flashcards', label: 'AI Flashcards' },
    { id: 'elibrary',   label: 'E-Library' },
    { id: 'portfolio',  label: 'Portfolio Builder' },
    { id: 'interview',  label: 'Interview Simulator' },
    { id: 'admissions', label: 'Admissions Calc' },
    { id: 'analytics',  label: 'Analytics' },
    { id: 'settings',   label: 'Settings' },
  ];

  /* ═══════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════ */
  return (
    <div className="flex h-screen w-screen bg-[#030014] text-white overflow-hidden font-sans">

      {/* ────────────── SIDEBAR ────────────── */}
      <aside className="w-60 shrink-0 flex flex-col bg-black/50 border-r border-white/5 overflow-y-auto">

        {/* Brand + sign out */}
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center font-black text-sm text-white flex-shrink-0" style={{ background: accent }}>M</div>
              <div>
                <p className="font-black text-sm tracking-tight leading-none">MedSchoolPrep</p>
                <p className="text-[10px] text-gray-500 mt-0.5">MCAT Prep Platform</p>
              </div>
            </div>
            <button onClick={signOut} title="Sign out"
              className="w-7 h-7 rounded-lg bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-500/30 flex items-center justify-center transition group">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="text-gray-500 group-hover:text-red-400 transition">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>

          {user.name && <p className="text-[11px] text-gray-500 mb-3 truncate">Hey, <span className="text-gray-300 font-semibold">{user.name.split(' ')[0]}</span> 👋</p>}

          {/* XP bar */}
          <div className="flex justify-between text-[10px] text-gray-500 mb-1">
            <span>Level {xpLevel}</span><span>{totalXP % 500}/500 XP</span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full rounded-full prog-fill" style={{ width: `${xpProgress}%`, background: accent }} />
          </div>

          {/* Course mastery ring */}
          {currentPath && (
            <div className="flex items-center gap-3 mt-3 p-2.5 bg-white/5 rounded-xl border border-white/5">
              <CircularProgress pct={courseMastery} accent={accent} size={46} />
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-white truncate">{currentPath.label}</p>
                <p className="text-[10px] text-gray-500">Course mastery</p>
              </div>
            </div>
          )}
        </div>

        {/* Specialty badge */}
        {user.specialty && (
          <div className="mx-3 mt-2.5 px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-2" style={{ borderColor: `${accent}40`, color: accent, background: `${accent}10` }}>
            <span>{PATHS[user.specialty].icon}</span>
            <span className="truncate">{PATHS[user.specialty].label}</span>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5 mt-2">
          {NAV.map(item => (
            <button key={item.id} onClick={() => navTo(item.id)}
              className={`flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm transition-all text-left ${tab === item.id ? 'bg-white/10 text-white font-semibold border border-white/10' : 'text-gray-500 hover:text-gray-200 hover:bg-white/5'}`}>
              {item.label}
            </button>
          ))}
        </nav>

        {/* Pomodoro */}
        <div className="p-3 border-t border-white/5">
          <div className="bg-white/5 rounded-xl p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{onBreak ? 'Break' : 'Focus'}</span>
              <button onClick={() => { setPomodoroActive(a => !a); if (!pomodoroActive) setPomodoroTimeLeft(onBreak ? 5*60 : 25*60); }}
                className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/20">
                {pomodoroActive ? 'Pause' : 'Start'}
              </button>
            </div>
            <p className="text-xl font-black text-center tracking-widest" style={{ color: accent }}>{fmtTime(pomodoroTimeLeft)}</p>
          </div>
        </div>
      </aside>

      {/* ────────────── MAIN CONTENT ────────────── */}
      <main className="flex-1 overflow-y-auto relative">
        <div className="pointer-events-none fixed top-0 right-0 w-[500px] h-[500px] rounded-full blur-[130px] opacity-10 transition-all" style={{ background: accent }} />
        <div className="max-w-5xl mx-auto p-8">

          {/* ══════ HOME ══════ */}
          {tab === 'home' && (
            <div>
              <div className="mb-6">
                <h1 className="text-4xl font-black mb-1">Hello, {user.name ? user.name.split(' ')[0] : 'Future Doctor'}</h1>
                <p className="text-gray-500">{user.specialty ? `You're on the ${PATHS[user.specialty].label} path.` : 'Take the Pathway Diagnostic to get your personalized plan.'}</p>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-4 gap-4 mb-5">
                {[
                  { label: 'Total XP', val: totalXP.toLocaleString(), color: '#f59e0b' },
                  { label: 'Level', val: xpLevel, color: '#3b82f6' },
                  { label: 'Day Streak', val: `${user.streak || 1}🔥`, color: '#ef4444' },
                  { label: 'Units Mastered', val: unitsMastered, color: '#10b981' },
                ].map(s => (
                  <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                    <p className="text-3xl font-black mb-1" style={{ color: s.color }}>{s.val}</p>
                    <p className="text-xs text-gray-500">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Continue button */}
              {currentPath && nextItem && nextItem.step !== 'complete' && (
                <div className="mb-5 p-5 rounded-2xl border cursor-pointer hover:opacity-90 transition"
                  style={{ background: `${accent}12`, borderColor: `${accent}40` }}
                  onClick={() => {
                    if (nextItem.step === 'mastery') { startMasteryCheck(nextItem.unit); setTab('pathway'); }
                    else { setActiveLessonView({ unit: nextItem.unit, lesson: nextItem.lesson, step: nextItem.step }); setTab('pathway'); }
                  }}>
                  <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: accent }}>Continue Where You Left Off</p>
                  <p className="font-bold text-white text-lg">
                    {nextItem.step === 'mastery'   ? `Mastery Check: ${nextItem.unit.title}` :
                     nextItem.step === 'video'     ? `Watch: ${nextItem.lesson.title}` :
                     nextItem.step === 'article'   ? `Read: ${nextItem.lesson.title}` :
                                                     `Practice: ${nextItem.lesson.title}`}
                  </p>
                  <p className="text-sm text-gray-400 mt-0.5">
                    {nextItem.unit?.title} — {nextItem.step === 'mastery' ? 'Unit Mastery Check' : nextItem.step === 'video' ? 'Video Lesson' : nextItem.step === 'article' ? 'Key Concepts Article' : 'Practice Questions'}
                  </p>
                </div>
              )}

              {/* Personalized Practice — weakest lessons */}
              {weakestLessons.length > 0 && (
                <div className="mb-5">
                  <h2 className="text-sm font-bold text-gray-400 mb-3">Suggested Practice — Your Weakest Topics</h2>
                  <div className="grid grid-cols-3 gap-3">
                    {weakestLessons.map(({ unit, lesson, level }) => {
                      const m = MASTERY[level];
                      return (
                        <button key={lesson.id}
                          onClick={() => { setActiveLessonView({ unit, lesson, step: 'practice' }); setTab('pathway'); }}
                          className="p-4 bg-white/5 border border-white/10 rounded-xl text-left hover:border-white/20 hover:bg-white/10 transition">
                          <div className="flex items-center gap-2 mb-2">
                            <MasteryDot level={level} size={18} />
                            <span className="text-[10px] font-bold" style={{ color: m.color }}>{m.label}</span>
                          </div>
                          <p className="text-xs font-bold text-white leading-snug">{lesson.title}</p>
                          <p className="text-[10px] text-gray-600 mt-1">{unit.title}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Quick actions */}
              <div className="grid grid-cols-2 gap-4">
                <button onClick={() => navTo(user.specialty ? 'pathway' : 'diagnostic')} className="p-5 bg-white/5 border border-white/10 rounded-2xl text-left hover:border-blue-500/40 hover:bg-blue-500/5 transition">
                  <h3 className="font-bold mb-1">{user.specialty ? 'Learning Pathway' : 'Take Pathway Diagnostic'}</h3>
                  <p className="text-sm text-gray-500">{user.specialty ? `${PATHS[user.specialty].label} — see all units` : 'Discover your specialty in 10 questions'}</p>
                </button>
                <button onClick={() => navTo('coach')} className="p-5 bg-white/5 border border-white/10 rounded-2xl text-left hover:border-violet-500/40 hover:bg-violet-500/5 transition">
                  <h3 className="font-bold mb-1">MetaBrain AI Coach</h3>
                  <p className="text-sm text-gray-500">Ask anything about MCAT concepts</p>
                </button>
                <button onClick={() => navTo('quiz')} className="p-5 bg-white/5 border border-white/10 rounded-2xl text-left hover:border-emerald-500/40 hover:bg-emerald-500/5 transition">
                  <h3 className="font-bold mb-1">Quiz Library</h3>
                  <p className="text-sm text-gray-500">Practice questions across all MCAT sections</p>
                </button>
                <button onClick={() => navTo('admissions')} className="p-5 bg-white/5 border border-white/10 rounded-2xl text-left hover:border-amber-500/40 hover:bg-amber-500/5 transition">
                  <h3 className="font-bold mb-1">Admissions Calculator</h3>
                  <p className="text-sm text-gray-500">Check your odds at top medical schools</p>
                </button>
              </div>
            </div>
          )}

          {/* ══════ DIAGNOSTIC ══════ */}
          {tab === 'diagnostic' && !diagDone && (
            <div>
              <h1 className="text-3xl font-black mb-2">Pathway Diagnostic</h1>
              <p className="text-gray-500 mb-8">Answer {DIAGNOSTIC_QS.length} questions to discover your ideal specialty path.</p>
              <div className="w-full bg-white/5 rounded-full h-2 mb-8 overflow-hidden">
                <div className="h-full rounded-full bg-blue-500 prog-fill" style={{ width: `${(diagStep / DIAGNOSTIC_QS.length) * 100}%` }} />
              </div>
              <div className="bg-white/5 border border-white/10 rounded-[24px] p-8">
                <p className="text-xs text-gray-500 mb-4">Question {diagStep + 1} of {DIAGNOSTIC_QS.length}</p>
                <h2 className="text-2xl font-bold mb-8">{DIAGNOSTIC_QS[diagStep].q}</h2>
                <div className="grid gap-3">
                  {DIAGNOSTIC_QS[diagStep].opts.map((opt, i) => (
                    <button key={i} onClick={() => handleDiagAnswer(diagStep, i)}
                      className="p-4 bg-white/5 border border-white/10 rounded-2xl text-left text-gray-300 hover:bg-blue-500/10 hover:border-blue-500/40 hover:text-white transition font-medium">
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {tab === 'diagnostic' && diagDone && user.specialty && (
            <div className="text-center max-w-lg mx-auto pt-12">
              <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6 text-4xl" style={{ background: `${PATHS[user.specialty].accent}20`, border: `1px solid ${PATHS[user.specialty].accent}40` }}>
                {PATHS[user.specialty].icon}
              </div>
              <h1 className="text-3xl font-black mb-3">Your Path: {PATHS[user.specialty].label}</h1>
              <p className="text-gray-400 mb-2">{PATHS[user.specialty].tagline}</p>
              <p className="text-sm text-gray-600 mb-8">+100 XP earned for completing the diagnostic!</p>
              <button onClick={() => navTo('pathway')} className="px-8 py-4 rounded-2xl font-black text-white text-lg transition hover:opacity-80" style={{ background: PATHS[user.specialty].accent }}>
                Begin My Learning Path →
              </button>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════
              LEARNING PATHWAY — Full Khan Academy progression
          ══════════════════════════════════════════════════════ */}

          {/* ── LESSON PRACTICE (5 questions) ── */}
          {tab === 'pathway' && lessonPracticeMode && activeLessonView && (
            <LessonPractice
              lesson={activeLessonView.lesson}
              unit={activeLessonView.unit}
              currentCorrectCount={getLessonState(pathway, activeLessonView.unit.id, activeLessonView.lesson.id).correctCount || 0}
              onBack={() => setLessonPracticeMode(false)}
              onFinish={(correct, total, newTotal) => {
                completeLessonPractice(activeLessonView.unit.id, activeLessonView.lesson.id, correct, total, newTotal);
                setLessonPracticeMode(false);
              }}
            />
          )}

          {/* ── UNIT MASTERY CHECK (8 questions) ── */}
          {tab === 'pathway' && !lessonPracticeMode && activeUnit?.mode === 'mastery' && activeMasteryQs && !activeLessonView && (
            <QuizEngine
              questions={activeMasteryQs}
              title={`Unit Mastery Check — ${activeUnit.unit.title}`}
              onBack={() => { setActiveUnit(null); setActiveMasteryQs(null); }}
              onFinish={(s, t) => finishMasteryCheck(s, t, activeUnit.unit)}
            />
          )}

          {/* ── QUIZ RESULTS ── */}
          {tab === 'pathway' && !lessonPracticeMode && !activeLessonView && quizResults && !activeUnit && (
            <div className="text-center max-w-md mx-auto pt-12">
              <div className={`w-24 h-24 rounded-3xl flex items-center justify-center mx-auto mb-6 text-5xl ${quizResults.passed ? 'bg-emerald-500/15 border border-emerald-500/30' : 'bg-blue-500/10 border border-blue-500/20'}`}>
                {quizResults.passed ? '🎉' : '📚'}
              </div>
              <h1 className="text-3xl font-black mb-3">{quizResults.passed ? 'Unit Mastered!' : 'Keep Practicing!'}</h1>
              <p className="text-5xl font-black mb-2">{quizResults.score}/{quizResults.total}</p>
              <p className="text-gray-500 mb-2">Needed {quizResults.unit.req}/{quizResults.unit.masteryTotal} to pass</p>
              <p className={`text-sm font-bold mb-8 ${quizResults.passed ? 'text-emerald-400' : 'text-yellow-400'}`}>
                {quizResults.passed ? `+${quizResults.unit.xp} XP — Next unit unlocked!` : `+${Math.floor(quizResults.unit.xp * 0.3)} XP — Review lessons and try again.`}
              </p>
              <button onClick={() => setQuizResults(null)} className="px-8 py-4 bg-white/10 border border-white/10 rounded-2xl font-bold hover:bg-white/20 transition">Return to Pathway</button>
            </div>
          )}

          {/* ── LESSON DETAIL VIEW (Video → Article → Practice) ── */}
          {tab === 'pathway' && !lessonPracticeMode && activeLessonView && !activeUnit && !quizResults && (() => {
            const { unit, lesson, step } = activeLessonView;
            const lstate = getLessonState(pathway, unit.id, lesson.id);
            const level  = lstate.masteryLevel || 0;
            const m      = MASTERY[level];

            const steps = [
              { id: 'video',    label: 'Watch Video',         done: lstate.videoWatched },
              { id: 'article',  label: 'Read Key Concepts',   done: lstate.articleRead  },
              { id: 'practice', label: 'Practice Questions',  done: level >= 3           },
            ];

            return (
              <div className="max-w-3xl mx-auto slide-in">
                {/* Back */}
                <button onClick={() => setActiveLessonView(null)} className="flex items-center gap-2 text-gray-500 hover:text-white text-sm mb-6 transition">
                  ← Back to {unit.title}
                </button>

                {/* Lesson header */}
                <div className="flex items-start gap-4 mb-6">
                  <MasteryDot level={level} size={32} />
                  <div className="flex-1">
                    <h1 className="text-2xl font-black mb-1">{lesson.title}</h1>
                    <p className="text-sm text-gray-500">{unit.cat} · {lesson.dur}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold" style={{ color: m.color }}>{m.label}</p>
                    <p className="text-xs text-gray-600">{lstate.correctCount || 0} correct answers</p>
                    {lstate.sessions > 0 && <p className="text-xs text-gray-600">{lstate.sessions} session{lstate.sessions !== 1 ? 's' : ''}</p>}
                  </div>
                </div>

                {/* Mastery progress bar */}
                <div className="mb-6">
                  <MasteryProgress level={level} correctCount={lstate.correctCount || 0} />
                </div>

                {/* Step tabs */}
                <div className="flex mb-8 bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                  {steps.map((s, si) => (
                    <button key={s.id}
                      onClick={() => setActiveLessonView(v => ({ ...v, step: s.id }))}
                      className={`flex-1 flex items-center justify-center gap-2 py-3.5 px-3 text-sm font-bold border-r border-white/10 last:border-r-0 transition ${step === s.id ? 'bg-white/10 text-white' : s.done ? 'text-emerald-400' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}>
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black flex-shrink-0 ${s.done ? 'bg-emerald-500 text-white' : step === s.id ? 'bg-white/20 text-white' : 'bg-white/10 text-gray-500'}`}>
                        {s.done ? '✓' : si + 1}
                      </span>
                      <span className="text-xs">{s.label}</span>
                    </button>
                  ))}
                </div>

                {/* ── VIDEO STEP ── */}
                {step === 'video' && (
                  <div className="slide-in">
                    <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden mb-5">
                      <div className="bg-black/50 p-10 flex flex-col items-center justify-center text-center">
                        <div className="w-16 h-16 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center mb-5">
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="#ef4444"><polygon points="5 3 19 12 5 21"/></svg>
                        </div>
                        <h3 className="font-bold text-white mb-1">{lesson.title}</h3>
                        <p className="text-sm text-gray-500 mb-6">{lesson.dur}</p>
                        <div className="flex gap-3">
                          <a href={lesson.yt} target="_blank" rel="noreferrer"
                            className="px-5 py-2.5 bg-red-500/20 border border-red-500/35 rounded-xl text-sm font-bold text-red-400 hover:bg-red-500/30 transition">
                            YouTube ↗
                          </a>
                          <a href={lesson.url} target="_blank" rel="noreferrer"
                            className="px-5 py-2.5 bg-white/10 border border-white/20 rounded-xl text-sm font-bold hover:bg-white/20 transition">
                            Khan Academy ↗
                          </a>
                        </div>
                      </div>
                    </div>

                    {/* High-yield note */}
                    <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl mb-6">
                      <span className="text-lg flex-shrink-0">💡</span>
                      <p className="text-sm text-amber-200/80 leading-relaxed">{lesson.note}</p>
                    </div>

                    {lstate.videoWatched ? (
                      <div className="flex gap-3">
                        <div className="flex-1 py-3.5 text-center text-sm font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                          ✓ Video Watched
                        </div>
                        <button onClick={() => setActiveLessonView(v => ({ ...v, step: 'article' }))}
                          className="flex-1 py-3.5 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-500 transition">
                          Read Key Concepts →
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => { markVideoWatched(unit.id, lesson.id); setActiveLessonView(v => ({ ...v, step: 'article' })); }}
                        className="w-full py-4 font-black text-white rounded-xl hover:opacity-80 transition" style={{ background: accent }}>
                        Mark as Watched · +10 XP →
                      </button>
                    )}
                  </div>
                )}

                {/* ── ARTICLE STEP ── */}
                {step === 'article' && (
                  <div className="slide-in">
                    <h2 className="text-xl font-black mb-5">Key Concepts</h2>
                    <div className="space-y-3 mb-8">
                      {(LESSON_POINTS[lesson.id] || [
                        'Complete the video above to review key concepts for this lesson.',
                        'Khan Academy provides detailed text articles alongside each video.',
                        'Focus on the high-yield note shown in the video tab.',
                        'After reading, attempt the practice questions to build mastery.',
                      ]).map((pt, i) => (
                        <div key={i} className="flex items-start gap-4 p-4 bg-white/5 border border-white/10 rounded-xl">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 border border-blue-500/30 text-[11px] font-black text-blue-400 flex items-center justify-center mt-0.5">{i + 1}</span>
                          <p className="text-sm text-gray-300 leading-relaxed">{pt}</p>
                        </div>
                      ))}
                    </div>

                    {lstate.articleRead ? (
                      <div className="flex gap-3">
                        <div className="flex-1 py-3.5 text-center text-sm font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                          ✓ Article Read
                        </div>
                        <button onClick={() => setActiveLessonView(v => ({ ...v, step: 'practice' }))}
                          className="flex-1 py-3.5 bg-violet-600 text-white font-black rounded-xl hover:bg-violet-500 transition">
                          Practice Questions →
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => { markArticleRead(unit.id, lesson.id); setActiveLessonView(v => ({ ...v, step: 'practice' })); }}
                        className="w-full py-4 font-black text-white rounded-xl hover:opacity-80 transition" style={{ background: accent }}>
                        Mark as Read · +15 XP →
                      </button>
                    )}
                  </div>
                )}

                {/* ── PRACTICE STEP ── */}
                {step === 'practice' && (
                  <div className="slide-in">
                    {/* Current mastery status */}
                    <div className="mb-6 p-5 bg-white/5 border border-white/10 rounded-2xl">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Your Mastery Level</p>
                          <div className="flex items-center gap-2">
                            <MasteryDot level={level} size={28} />
                            <span className="font-black text-lg" style={{ color: m.color }}>{m.label}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-600 mb-1">{lstate.correctCount || 0} total correct</p>
                          <p className="text-xs text-gray-600">{lstate.sessions || 0} session{(lstate.sessions || 0) !== 1 ? 's' : ''} completed</p>
                        </div>
                      </div>
                      <MasteryProgress level={level} correctCount={lstate.correctCount || 0} />
                    </div>

                    {/* All 4 mastery levels shown */}
                    <div className="grid grid-cols-4 gap-2 mb-6">
                      {[0,1,2,3].map(l => {
                        const ml = MASTERY[l];
                        const isActive = l === level;
                        return (
                          <div key={l} className="p-3 rounded-xl border text-center transition-all"
                            style={{ background: isActive ? ml.bg : 'rgba(255,255,255,0.03)', borderColor: isActive ? ml.border : 'rgba(255,255,255,0.07)' }}>
                            <MasteryDot level={l} size={24} />
                            <p className="text-[10px] font-bold mt-2" style={{ color: isActive ? ml.color : '#4b5563' }}>{ml.label}</p>
                            <p className="text-[9px] text-gray-700 mt-0.5">{MASTERY_THRESHOLDS[l]}+ correct</p>
                          </div>
                        );
                      })}
                    </div>

                    {/* What next message */}
                    {level < 3 ? (
                      <p className="text-sm text-gray-500 mb-6">
                        Answer practice questions to advance your mastery.
                        You need <span className="text-white font-bold">{nextThreshold(level) - (lstate.correctCount || 0)} more correct answer{nextThreshold(level) - (lstate.correctCount || 0) !== 1 ? 's' : ''}</span> to reach <span style={{ color: MASTERY[level + 1]?.color }} className="font-bold">{MASTERY[level + 1]?.label}</span>.
                      </p>
                    ) : (
                      <p className="text-sm text-emerald-400 mb-6">⭐ You've mastered this lesson! Keep practicing to stay sharp.</p>
                    )}

                    <button onClick={() => setLessonPracticeMode(true)}
                      className="w-full py-4 font-black text-white rounded-xl hover:opacity-80 transition" style={{ background: level >= 3 ? '#10b981' : accent }}>
                      {level >= 3 ? 'Practice Again (Stay Sharp)' : 'Start Practice Questions →'}
                    </button>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── PATHWAY OVERVIEW (unit list) ── */}
          {tab === 'pathway' && !lessonPracticeMode && !activeLessonView && !activeUnit && !quizResults && (
            <div>
              {!user.specialty ? (
                <div className="text-center py-20">
                  <h2 className="text-2xl font-bold mb-3">No Pathway Assigned</h2>
                  <p className="text-gray-500 mb-6">Complete the diagnostic to get your personalized learning path.</p>
                  <button onClick={() => navTo('diagnostic')} className="px-6 py-3 bg-blue-600 rounded-xl font-bold hover:bg-blue-500 transition">Take the Diagnostic →</button>
                </div>
              ) : (
                <div>
                  {/* Path header with course mastery ring */}
                  <div className="flex items-start justify-between mb-8">
                    <div>
                      <h1 className="text-3xl font-black mb-1">{PATHS[user.specialty].label} Pathway</h1>
                      <p className="text-gray-500">{PATHS[user.specialty].tagline}</p>
                      <p className="text-sm text-gray-600 mt-2">{unitsMastered}/{PATHS[user.specialty].units.length} units mastered</p>
                    </div>
                    <CircularProgress pct={courseMastery} accent={accent} size={80} />
                  </div>

                  {/* Unit cards */}
                  <div className="space-y-5">
                    {PATHS[user.specialty].units.map((unit, idx) => {
                      const us            = pathway[unit.id] || { unlocked: idx === 0, masteryScore: null, lessons: {} };
                      const unitPct       = calcUnitMastery(pathway, unit);
                      const unitPassed    = (us.masteryScore || 0) >= unit.req;
                      const allAtLeastFamiliar = unit.lessons.every(l => getLessonState(pathway, unit.id, l.id).masteryLevel >= 1);
                      const lessonsStarted = unit.lessons.filter(l => getLessonState(pathway, unit.id, l.id).masteryLevel > 0).length;

                      return (
                        <div key={unit.id} className={`border rounded-[22px] overflow-hidden transition-all ${us.unlocked ? PATHS[user.specialty].border : 'border-white/5'} ${!us.unlocked ? 'opacity-50' : ''}`}
                          style={{ background: 'rgba(5,5,16,0.75)' }}>

                          {/* Unit header */}
                          <div className="p-5 flex items-center gap-4">
                            <CircularProgress pct={unitPct} accent={unitPassed ? '#10b981' : accent} size={64} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                <h3 className="font-black text-base">{unit.title}</h3>
                                {unitPassed && <span className="text-[9px] font-black text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full shrink-0">MASTERED</span>}
                                {!us.unlocked && <span className="text-[9px] text-gray-600 shrink-0">🔒 Locked</span>}
                              </div>
                              <p className="text-sm text-gray-500">{unit.desc}</p>
                              <div className="flex items-center gap-1.5 mt-2.5">
                                {unit.lessons.map(l => {
                                  const lstate = getLessonState(pathway, unit.id, l.id);
                                  return <MasteryDot key={l.id} level={lstate.masteryLevel || 0} size={20} />;
                                })}
                                <span className="text-[10px] text-gray-600 ml-1">{lessonsStarted}/{unit.lessons.length} lessons started · +{unit.xp} XP</span>
                              </div>
                            </div>

                            {us.unlocked && (
                              <div className="flex flex-col gap-2 flex-shrink-0">
                                <button
                                  onClick={() => {
                                    const first = unit.lessons.find(l => {
                                      const lstate = getLessonState(pathway, unit.id, l.id);
                                      return !lstate.videoWatched || !lstate.articleRead || lstate.masteryLevel < 3;
                                    });
                                    const target = first || unit.lessons[0];
                                    const lstate = getLessonState(pathway, unit.id, target.id);
                                    const step = !lstate.videoWatched ? 'video' : !lstate.articleRead ? 'article' : 'practice';
                                    setActiveLessonView({ unit, lesson: target, step });
                                  }}
                                  className="px-4 py-2 rounded-xl text-sm font-black text-white transition hover:opacity-80"
                                  style={{ background: accent }}>
                                  {lessonsStarted === unit.lessons.length ? 'Review' : 'Study →'}
                                </button>
                                {allAtLeastFamiliar && (
                                  <button onClick={() => startMasteryCheck(unit)}
                                    className={`px-4 py-2 rounded-xl text-xs font-bold transition border ${unitPassed ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25' : 'bg-white/10 border-white/20 text-white hover:bg-white/20'}`}>
                                    {unitPassed ? '★ Mastery Check' : 'Mastery Check'}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Lesson list (expandable row per lesson) */}
                          {us.unlocked && (
                            <div className="border-t border-white/5 divide-y divide-white/5">
                              {unit.lessons.map((lesson, li) => {
                                const lstate = getLessonState(pathway, unit.id, lesson.id);
                                const level  = lstate.masteryLevel || 0;
                                const step   = !lstate.videoWatched ? 'video' : !lstate.articleRead ? 'article' : 'practice';
                                return (
                                  <button key={lesson.id}
                                    onClick={() => setActiveLessonView({ unit, lesson, step })}
                                    className="w-full flex items-center gap-3 px-5 py-4 hover:bg-white/5 transition text-left group">
                                    <MasteryDot level={level} size={22} />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-semibold group-hover:text-white transition truncate">{lesson.title}</p>
                                      <p className="text-xs text-gray-600 mt-0.5">{lesson.dur}</p>
                                    </div>
                                    {/* Step indicators */}
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                      <span title="Video"   className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${lstate.videoWatched ? 'bg-blue-500 text-white' : 'bg-white/10 text-gray-600'}`}>▶</span>
                                      <span title="Article" className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${lstate.articleRead ? 'bg-blue-500 text-white' : 'bg-white/10 text-gray-600'}`}>A</span>
                                      <span title="Practice" className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${level >= 3 ? 'bg-emerald-500 text-white' : level > 0 ? 'bg-amber-500 text-white' : 'bg-white/10 text-gray-600'}`}>P</span>
                                      <span className="text-xs font-bold ml-1" style={{ color: MASTERY[level].color }}>{MASTERY[level].dot}</span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══════ QUIZ LIBRARY ══════ */}
          {tab === 'quiz' && (
            <div>
              {activeLibQuiz ? (
                <QuizEngine questions={activeLibQuiz} title="Quiz Library" onBack={() => setActiveLibQuiz(null)} onFinish={() => setActiveLibQuiz(null)} />
              ) : (
                <div>
                  <h1 className="text-3xl font-black mb-2">Quiz Library</h1>
                  <p className="text-gray-500 mb-6">Practice MCAT questions across all tested categories.</p>
                  <div className="flex gap-2 mb-5 flex-wrap">
                    {['All','Bio/Biochem','Chem/Phys','Psych/Soc'].map(c => (
                      <button key={c} onClick={() => setQuizLibCat(c)} className={`px-4 py-1.5 rounded-full text-xs font-bold border transition ${quizLibCat === c ? 'bg-white text-black border-white' : 'border-white/20 text-gray-400 hover:border-white/40'}`}>{c}</button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {['Biochemistry Essentials','Cardiovascular Physics','Genetics & Molecular Biology','Psychosocial & Behavior','Organic Chemistry','Electrochemistry & Equilibria'].map((name, si) => {
                      const qs = libQs.slice(si * 5, si * 5 + 5).filter(Boolean);
                      if (!qs.length) return null;
                      return (
                        <div key={si} className="bg-white/5 border border-white/10 rounded-2xl p-5 hover:border-blue-500/30 transition">
                          <div className="text-xs font-bold text-blue-400 mb-1">{qs[0]?.cat || 'Mixed'}</div>
                          <h3 className="font-bold mb-4">{name}</h3>
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-gray-600">{qs.length} questions</span>
                            <button onClick={() => setActiveLibQuiz(qs)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-500 transition">Start →</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══════ AI COACH ══════ */}
          {tab === 'coach' && (
            <div className="flex flex-col h-[calc(100vh-8rem)]">
              <h1 className="text-3xl font-black mb-6">MetaBrain AI Coach</h1>
              <div className="flex-1 overflow-y-auto space-y-4 pb-4">
                {msgs.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed ${m.role === 'user' ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-white/5 border border-white/10 text-gray-200 rounded-tl-sm'}`}>{m.content}</div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white/5 border border-white/10 rounded-2xl rounded-tl-sm p-4">
                      <div className="flex gap-1.5">
                        <div className="w-2 h-2 bg-blue-400 rounded-full bdot1" />
                        <div className="w-2 h-2 bg-blue-400 rounded-full bdot2" />
                        <div className="w-2 h-2 bg-blue-400 rounded-full bdot3" />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={msgsEndRef} />
              </div>
              <div className="mt-4">
                <div className="flex gap-2 mb-3 flex-wrap">
                  {['Explain the Nernst equation','How does the lac operon work?','MMI tips for ethics stations','Glycolysis high-yield facts'].map(p => (
                    <button key={p} onClick={() => setChatInput(p)} className="text-[10px] bg-white/5 border border-white/10 px-3 py-1.5 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition">{p}</button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()}
                    placeholder="Ask about any MCAT concept or study strategy..."
                    className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 outline-none focus:border-blue-500/50 text-sm placeholder:text-gray-600" />
                  <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()} className="px-6 py-3.5 bg-blue-600 rounded-2xl font-bold text-sm hover:bg-blue-500 disabled:opacity-40 transition">Send</button>
                </div>
              </div>
            </div>
          )}

          {/* ══════ FLASHCARDS ══════ */}
          {tab === 'flashcards' && (
            <div>
              <h1 className="text-3xl font-black mb-2">AI Flashcards</h1>
              <p className="text-gray-500 mb-8">Paste your notes — MetaBrain generates high-yield flashcard decks.</p>
              {activeDeck && flashDecks[activeDeck] ? (
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <button onClick={() => setActiveDeck(null)} className="text-gray-500 hover:text-white text-sm transition">← All Decks</button>
                    <span className="text-xs text-gray-500">{cardIdx + 1} / {flashDecks[activeDeck].length}</span>
                  </div>
                  <div className="flex justify-center mb-6 cursor-pointer" onClick={() => setCardFlipped(f => !f)}>
                    <div className="w-full max-w-lg h-60" style={{ perspective: '1000px' }}>
                      <div className="relative w-full h-full transition-transform duration-500" style={{ transformStyle: 'preserve-3d', transform: cardFlipped ? 'rotateY(180deg)' : 'none' }}>
                        <div className="absolute inset-0 bg-white/5 border border-white/10 rounded-[28px] flex flex-col items-center justify-center p-8 text-center backface-hidden">
                          <p className="text-xs text-gray-500 mb-4 uppercase tracking-widest">Front</p>
                          <p className="text-xl font-bold">{flashDecks[activeDeck][cardIdx]?.front}</p>
                        </div>
                        <div className="absolute inset-0 bg-blue-600/20 border border-blue-500/40 rounded-[28px] flex flex-col items-center justify-center p-8 text-center" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                          <p className="text-xs text-blue-400 mb-4 uppercase tracking-widest">Back</p>
                          <p className="text-lg text-gray-200">{flashDecks[activeDeck][cardIdx]?.back}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <p className="text-center text-xs text-gray-600 mb-6">Click card to flip</p>
                  <div className="flex gap-3 justify-center">
                    <button onClick={() => { setCardIdx(i => Math.max(0, i-1)); setCardFlipped(false); }} disabled={cardIdx === 0} className="px-5 py-2.5 bg-white/5 border border-white/10 rounded-xl font-bold text-sm disabled:opacity-30 hover:bg-white/10 transition">← Prev</button>
                    <button onClick={() => { setCardIdx(i => Math.min(flashDecks[activeDeck].length-1, i+1)); setCardFlipped(false); }} disabled={cardIdx === flashDecks[activeDeck].length - 1} className="px-5 py-2.5 bg-blue-600 rounded-xl font-bold text-sm disabled:opacity-30 hover:bg-blue-500 transition">Next →</button>
                  </div>
                </div>
              ) : (
                <div>
                  {Object.keys(flashDecks).length > 0 && (
                    <div className="grid grid-cols-3 gap-4 mb-8">
                      {Object.keys(flashDecks).map(name => (
                        <button key={name} onClick={() => { setActiveDeck(name); setCardIdx(0); setCardFlipped(false); }}
                          className="p-5 bg-white/5 border border-white/10 rounded-2xl text-left hover:border-blue-500/40 transition">
                          <p className="font-bold text-sm mb-1">{name}</p>
                          <p className="text-xs text-gray-500">{flashDecks[name].length} cards</p>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                    <h3 className="font-bold mb-4">Generate New Deck from Notes</h3>
                    <textarea value={flashInput} onChange={e => setFlashInput(e.target.value)}
                      placeholder="Paste your study notes here. MetaBrain will extract 8-12 high-yield flashcards."
                      rows={6} className="w-full bg-black/30 border border-white/10 rounded-xl p-4 text-sm outline-none focus:border-blue-500/50 text-gray-300 placeholder:text-gray-700 resize-none mb-4" />
                    <button onClick={generateFlashcards} disabled={flashLoading || !flashInput.trim()} className="px-6 py-3 bg-blue-600 rounded-xl font-bold text-sm hover:bg-blue-500 disabled:opacity-40 transition">
                      {flashLoading ? 'Generating...' : 'Generate with AI'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══════ E-LIBRARY ══════ */}
          {tab === 'elibrary' && (
            <div>
              <h1 className="text-3xl font-black mb-2">E-Library</h1>
              <p className="text-gray-500 mb-6">Curated, high-quality MCAT resources.</p>
              <div className="flex gap-2 mb-4 flex-wrap">
                {['All','Bio/Biochem','Chem/Phys','Psych/Soc'].map(c => (
                  <button key={c} onClick={() => setLibCat(c)} className={`px-4 py-1.5 rounded-full text-xs font-bold border transition ${libCat === c ? 'bg-white text-black border-white' : 'border-white/20 text-gray-400 hover:border-white/40'}`}>{c}</button>
                ))}
              </div>
              <input value={libSearch} onChange={e => setLibSearch(e.target.value)} placeholder="Search resources..."
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-blue-500/50 placeholder:text-gray-600 mb-5" />
              <div className="grid grid-cols-2 gap-4">
                {filteredLib.map((r, i) => (
                  <a key={i} href={r.url} target="_blank" rel="noreferrer" className="p-5 bg-white/5 border border-white/10 rounded-2xl hover:border-blue-500/40 hover:bg-blue-500/5 transition group block">
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-xs font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full">{r.type}</span>
                      {r.free ? <span className="text-[10px] font-bold text-emerald-400">FREE</span> : <span className="text-[10px] text-gray-600">Paid</span>}
                    </div>
                    <h3 className="font-bold text-sm mb-2 group-hover:text-white transition">{r.title}</h3>
                    <p className="text-xs text-gray-500">{r.desc}</p>
                  </a>
                ))}
                {filteredLib.length === 0 && <p className="col-span-2 text-center text-gray-600 py-12">No resources match your search.</p>}
              </div>
            </div>
          )}

          {/* ══════ PORTFOLIO ══════ */}
          {tab === 'portfolio' && (
            <div>
              <h1 className="text-3xl font-black mb-2">Portfolio Builder</h1>
              <p className="text-gray-500 mb-8">Track activities and discover opportunities to strengthen your application.</p>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h2 className="text-lg font-bold mb-4">My Activities</h2>
                  <div className="space-y-3 mb-4">
                    {portfolio.length === 0 ? (
                      <div className="border border-dashed border-white/10 rounded-2xl p-6 text-center"><p className="text-gray-600 text-sm">Add activities to build your timeline</p></div>
                    ) : portfolio.map((a, i) => (
                      <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between">
                        <div><p className="font-bold text-sm">{a.title}</p><p className="text-xs text-gray-500">{a.type} · {a.date}</p></div>
                        <button onClick={() => setPortfolio(p => p.filter((_, j) => j !== i))} className="text-red-400/60 hover:text-red-400 text-xs">Remove</button>
                      </div>
                    ))}
                  </div>
                  <PortfolioAdder onAdd={a => setPortfolio(p => [...p, a])} />
                </div>
                <div>
                  <h2 className="text-lg font-bold mb-4">Opportunities</h2>
                  <div className="space-y-3">
                    {OPPORTUNITIES.map(op => (
                      <div key={op.id} className="bg-white/5 border border-white/10 rounded-xl p-4">
                        <div className="flex justify-between items-start mb-1">
                          <h3 className="font-bold text-sm">{op.name}</h3>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${op.diff === 'Elite' ? 'bg-red-500/20 text-red-400' : op.diff === 'Competitive' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-emerald-500/20 text-emerald-400'}`}>{op.diff}</span>
                        </div>
                        <p className="text-xs text-gray-500 mb-2">{op.desc}</p>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-gray-600">Deadline: {op.deadline}</span>
                          <div className="flex gap-2">
                            <button onClick={() => setPortfolio(p => [...p, { title: op.name, type: op.type, date: op.deadline }])} className="text-[10px] font-bold bg-white/10 px-2 py-1 rounded-lg hover:bg-white/20 transition">+ Add</button>
                            {op.url !== '#' && <a href={op.url} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-blue-400 hover:text-blue-300">Learn ↗</a>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════ INTERVIEW ══════ */}
          {tab === 'interview' && (
            <div>
              <h1 className="text-3xl font-black mb-2">MMI Interview Simulator</h1>
              <p className="text-gray-500 mb-6">Practice Multiple Mini Interview questions with AI feedback.</p>
              {!interviewQ ? (
                <div>
                  <div className="flex gap-2 mb-5 flex-wrap">
                    {['All','Ethics','Personal','Policy','Professionalism','Motivation','Leadership','Cultural Competency','Reflection','Healthcare Systems','End-of-Life'].map(t => (
                      <button key={t} onClick={() => setInterviewType(t)} className={`px-3 py-1 rounded-full text-[10px] font-bold border transition ${interviewType === t ? 'bg-white text-black border-white' : 'border-white/20 text-gray-400 hover:border-white/40'}`}>{t}</button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {filteredMMI.map((q, i) => (
                      <button key={i} onClick={() => { setInterviewQ(q); setInterviewAnswer(''); setInterviewFeedback(''); }}
                        className="p-5 bg-white/5 border border-white/10 rounded-2xl text-left hover:border-violet-500/40 hover:bg-violet-500/5 transition group">
                        <span className="text-[10px] font-bold text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded-full inline-block mb-3">{q.type}</span>
                        <p className="text-sm font-medium text-gray-300 group-hover:text-white transition">{q.q}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <button onClick={() => setInterviewQ(null)} className="text-gray-500 hover:text-white text-sm mb-6 transition">← Back to Questions</button>
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
                    <span className="text-xs font-bold text-violet-400">{interviewQ.type}</span>
                    <h2 className="text-xl font-bold mt-2">{interviewQ.q}</h2>
                  </div>
                  <textarea value={interviewAnswer} onChange={e => setInterviewAnswer(e.target.value)}
                    placeholder="Type your response here... (Aim for 2-3 minutes of structured content)"
                    rows={7} className="w-full bg-white/5 border border-white/10 rounded-2xl p-5 text-sm text-gray-200 outline-none focus:border-violet-500/50 placeholder:text-gray-700 resize-none mb-4" />
                  <button onClick={getInterviewFeedback} disabled={interviewLoading || !interviewAnswer.trim()}
                    className="px-6 py-3 bg-violet-600 rounded-xl font-bold text-sm hover:bg-violet-500 disabled:opacity-40 transition mb-6">
                    {interviewLoading ? 'Analyzing...' : 'Get AI Feedback'}
                  </button>
                  {interviewFeedback && (
                    <div className="bg-violet-500/10 border border-violet-500/30 rounded-2xl p-6">
                      <h3 className="font-bold mb-3 text-violet-300">AI Coach Feedback</h3>
                      <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{interviewFeedback}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ══════ ADMISSIONS ══════ */}
          {tab === 'admissions' && (
            <div>
              <h1 className="text-3xl font-black mb-2">Admissions Calculator</h1>
              <p className="text-gray-500 mb-8">Compare your profile against top medical schools.</p>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="col-span-1 bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                  <h3 className="font-bold">Your Profile</h3>
                  {[
                    { l:'Cumulative GPA', v:gpa,         fn:setGpa,          ph:'3.85', type:'number', step:'0.01', min:'2', max:'4' },
                    { l:'MCAT (472–528)', v:mcat,         fn:setMcat,         ph:'514',  type:'number', min:'472',  max:'528' },
                    { l:'Clinical Hours', v:clinicalHrs,  fn:setClinicalHrs,  ph:'1000', type:'number' },
                    { l:'Volunteer Hours',v:volunteerHrs, fn:setVolunteerHrs, ph:'200',  type:'number' },
                  ].map(f => (
                    <div key={f.l}>
                      <label className="block text-xs text-gray-500 mb-1">{f.l}</label>
                      <input type={f.type} value={f.v} onChange={e => f.fn(e.target.value)} placeholder={f.ph} step={f.step} min={f.min} max={f.max}
                        className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-blue-500/50 text-sm" />
                    </div>
                  ))}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={hasResearch} onChange={e => setHasResearch(e.target.checked)} className="rounded" />
                    <span className="text-sm text-gray-400">Research experience</span>
                  </label>
                  <button onClick={calcAdmissions} className="w-full py-3 bg-amber-500 text-black font-black rounded-xl hover:bg-amber-400 transition">Calculate →</button>
                </div>
                <div className="col-span-2">
                  {calcResults ? (
                    <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                      {calcResults.map(s => (
                        <div key={s.name} className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between">
                          <div>
                            <p className="font-bold text-sm">{s.name}</p>
                            <p className="text-xs text-gray-500">Avg GPA {s.avgGPA} · MCAT {s.avgMCAT} · {s.acceptRate}% accept</p>
                          </div>
                          <span className={`text-xs font-black px-3 py-1 rounded-full ${s.chance === 'Safety' ? 'bg-emerald-500/20 text-emerald-400' : s.chance === 'Target' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}>{s.chance}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="h-full border border-dashed border-white/10 rounded-2xl flex items-center justify-center">
                      <p className="text-gray-600 text-sm">Enter your profile and click Calculate</p>
                    </div>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-700">⚠️ Estimates based on published averages. Essays, research, and clinical experience significantly impact outcomes.</p>
            </div>
          )}

          {/* ══════ ANALYTICS ══════ */}
          {tab === 'analytics' && (
            <div>
              <h1 className="text-3xl font-black mb-8">Analytics</h1>
              <div className="grid grid-cols-3 gap-4 mb-8">
                {[
                  { label:'Total XP', val:user.xp.toLocaleString(), sub:`Level ${xpLevel}`, color:'#f59e0b' },
                  { label:'Units Mastered', val:unitsMastered, sub:`of ${currentPath?.units?.length || 0} total`, color:'#10b981' },
                  { label:'Course Mastery', val:`${courseMastery}%`, sub:currentPath?.label || 'No path yet', color:'#3b82f6' },
                ].map(s => (
                  <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl p-6">
                    <p className="text-3xl font-black mb-1" style={{ color: s.color }}>{s.val}</p>
                    <p className="font-bold text-sm">{s.label}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{s.sub}</p>
                  </div>
                ))}
              </div>

              {Object.keys(catPerf).length > 0 && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
                  <h3 className="font-bold mb-6">Category Performance</h3>
                  <div className="space-y-5">
                    {Object.entries(catPerf).map(([cat, data]) => {
                      const avg = Math.round(data.total / data.count);
                      const color = avg >= 75 ? '#10b981' : avg >= 50 ? '#f59e0b' : '#ef4444';
                      return (
                        <div key={cat}>
                          <div className="flex justify-between text-sm mb-1.5">
                            <span className="font-medium">{cat}</span>
                            <span style={{ color }}>{avg}% avg · Last: {data.last}%</span>
                          </div>
                          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-2 rounded-full prog-fill" style={{ width: `${avg}%`, background: color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {currentPath && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                  <h3 className="font-bold mb-6">Unit Mastery — {currentPath.label}</h3>
                  <div className="space-y-5">
                    {currentPath.units.map(unit => {
                      const pct = calcUnitMastery(pathway, unit);
                      return (
                        <div key={unit.id} className="flex items-center gap-4">
                          <CircularProgress pct={pct} accent={accent} size={52} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-semibold text-sm truncate">{unit.title}</span>
                              <span className="text-xs text-gray-500 ml-2 flex-shrink-0">{pct}%</span>
                            </div>
                            <div className="flex gap-1.5 flex-wrap">
                              {unit.lessons.map(l => <MasteryDot key={l.id} level={getLessonState(pathway, unit.id, l.id).masteryLevel || 0} size={20} />)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══════ SETTINGS ══════ */}
          {tab === 'settings' && (
            <div>
              <h1 className="text-3xl font-black mb-2">Settings</h1>
              <p className="text-gray-500 mb-8">Customize your MedSchoolPrep experience.</p>
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 max-w-lg">
                <h3 className="font-bold mb-5">Your Profile</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Display Name</label>
                    <input value={settingsName || user.name} onChange={e => setSettingsName(e.target.value)} placeholder="Your name"
                      className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-blue-500/50 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Specialty Path</label>
                    <select value={user.specialty || ''} onChange={e => {
                      const sp = e.target.value;
                      setUser(u => ({ ...u, specialty: sp || null }));
                      if (sp) {
                        const init = {};
                        PATHS[sp].units.forEach((u, i) => { init[u.id] = { unlocked: i === 0, masteryScore: null, lessons: {} }; });
                        setPathway(prev => ({ ...init, ...prev }));
                      }
                    }} className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-blue-500/50 text-sm">
                      <option value="">No pathway selected</option>
                      {Object.entries(PATHS).map(([id, p]) => <option key={id} value={id}>{p.icon} {p.label}</option>)}
                    </select>
                  </div>
                  <button onClick={() => {
                    if (settingsName.trim()) setUser(u => ({ ...u, name: settingsName.trim() }));
                    setSettingsSaved(true);
                    setTimeout(() => setSettingsSaved(false), 2000);
                  }} className="w-full py-3 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-500 transition">
                    {settingsSaved ? 'Saved! ✓' : 'Save Changes'}
                  </button>
                </div>
                <div className="mt-6 pt-6 border-t border-white/10">
                  <h3 className="font-bold mb-3 text-red-400">Danger Zone</h3>
                  <button onClick={() => {
                    if (window.confirm('Reset all progress? This cannot be undone.')) {
                      ['msp_user','msp_pathway','msp_flash','msp_port','msp_catperf'].forEach(k => localStorage.removeItem(k));
                      window.location.reload();
                    }
                  }} className="px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm font-bold hover:bg-red-500/20 transition">
                    Reset All Progress
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
