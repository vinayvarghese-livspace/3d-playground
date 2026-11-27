/**
 * Primary workflow prompt builder (pure logic).
 * Used by primary-prompt-lab.html and ../tasks.js — keep Replacement out of this file.
 *
 * Slot order: A1 → A2 → A3 → B1..B4 (skip missing A*; B is compulsory, count 1–4).
 * Prompt body follows the simplified Primary composition template.
 */
(function (root) {
  'use strict';

  function clampBCount(n) {
    const v = Number(n);
    if (isNaN(v) || v < 1) return 1;
    return Math.min(4, Math.floor(v));
  }

  /**
   * Answerly Image-to-Image API / Jobs UI field names (1-based slot index).
   * 1: reference_image_url
   * 2: second_reference_url
   * 3: third_reference_url
   * 4+: reference_4_url, reference_5_url, …
   */
  function answerlyRefKey(n) {
    const i = Math.max(1, Math.floor(Number(n) || 1));
    if (i === 1) return 'reference_image_url';
    if (i === 2) return 'second_reference_url';
    if (i === 3) return 'third_reference_url';
    return 'reference_' + i + '_url';
  }

  /** Canonical catalog index from a prompt ref token (old _N or live Answerly names). */
  function canonNumFromRefToken(token) {
    const k = String(token || '').trim();
    if (!k) return null;
    if (k === 'reference_image_url') return 1;
    if (k === 'second_reference_url') return 2;
    if (k === 'third_reference_url') return 3;
    let m = k.match(/^reference_(\d+)_url$/);
    if (m) return Number(m[1]);
    m = k.match(/^reference_image_url_(\d+)$/);
    if (m) return Number(m[1]);
    if (k === 'fourth_reference_url') return 4;
    if (k === 'fifth_reference_url') return 5;
    if (k === 'sixth_reference_url') return 6;
    if (k === 'seventh_reference_url') return 7;
    if (k === 'eighth_reference_url') return 8;
    return null;
  }

  /**
   * @param {{ hasA1?: boolean, hasA2?: boolean, hasA3?: boolean, bCount?: number }} opts
   */
  function buildPlan(opts) {
    const o = opts || {};
    const hasA1 = !!o.hasA1;
    const hasA2 = !!o.hasA2;
    const hasA3 = !!o.hasA3;
    const bCount = clampBCount(o.bCount == null ? 1 : o.bCount);
    const slots = [];
    let n = 1;
    if (hasA1) {
      slots.push({ role: 'a1', refKey: answerlyRefKey(n), inputImage: n, label: 'MASTER BACKGROUND' });
      n += 1;
    }
    if (hasA2) {
      slots.push({ role: 'a2', refKey: answerlyRefKey(n), inputImage: n, label: 'CAMERA REFERENCE' });
      n += 1;
    }
    if (hasA3) {
      slots.push({ role: 'a3', refKey: answerlyRefKey(n), inputImage: n, label: 'OPTIONAL REFERENCE' });
      n += 1;
    }
    const bStartNum = n;
    for (let i = 0; i < bCount; i++) {
      slots.push({
        role: 'b',
        bIndex: i,
        refKey: answerlyRefKey(n),
        inputImage: n,
        label: 'PRODUCT REFERENCE'
      });
      n += 1;
    }
    return {
      hasA1: hasA1,
      hasA2: hasA2,
      hasA3: hasA3,
      bCount: bCount,
      bStartNum: bStartNum,
      slots: slots
    };
  }

  function refTick(plan, role) {
    const slot = (plan.slots || []).find((s) => s.role === role);
    return slot ? ('`' + slot.refKey + '`') : '';
  }

  function productSlots(plan) {
    return (plan.slots || []).filter((s) => s.role === 'b');
  }

  function productRefRange(plan) {
    const b = productSlots(plan);
    if (!b.length) return '';
    if (b.length === 1) return '`' + b[0].refKey + '`';
    return '`' + b[0].refKey + '` to `' + b[b.length - 1].refKey + '`';
  }

  /** Uppercase range for PRODUCT REFERENCES heading (TO). */
  function productRefRangeHeading(plan) {
    const b = productSlots(plan);
    if (!b.length) return '';
    if (b.length === 1) return '`' + b[0].refKey + '`';
    return '`' + b[0].refKey + '` TO `' + b[b.length - 1].refKey + '`';
  }

  function productRefsPhrase(plan) {
    const list = productSlots(plan).map((s) => '`' + s.refKey + '`');
    if (!list.length) return 'the product reference images';
    if (list.length === 1) return list[0];
    if (list.length === 2) return list[0] + ' and ' + list[1];
    return list.slice(0, -1).join(', ') + ', and ' + list[list.length - 1];
  }

  function heading(slot, roleLabel) {
    return '**INPUT IMAGE ' + slot.inputImage + ' — `' + slot.refKey + '` — ' + roleLabel + '**';
  }

  function blockA1(slot) {
    return [
      heading(slot, 'MASTER BACKGROUND'),
      '',
      'The source of the background and environment for the final image.',
      '',
      'Preserve its existing elements, including architecture, furniture, props, surfaces, colours, materials, textures, and overall design. Do not unnecessarily add, remove, or redesign anything.'
    ].join('\n');
  }

  function blockA2(slot) {
    return [
      heading(slot, 'CAMERA REFERENCE'),
      '',
      'Use this image exclusively to determine the final camera setup:',
      '- Camera angle, viewpoint, position, and orientation.',
      '- Elevation, direction, and rotation.',
      '- Field of view (FOV) and zoom.',
      '- Perspective, framing, and crop.',
      '',
      'Do not use any visual content from this image, including its products, objects, background, colours, materials, textures, or lighting.'
    ].join('\n');
  }

  function blockA3(slot) {
    return [
      heading(slot, 'OPTIONAL REFERENCE'),
      '',
      'Use only for the specific purpose described in the additional instructions for that generation. Do not assume its role.'
    ].join('\n');
  }

  function blockProduct(plan) {
    const rangeHead = productRefRangeHeading(plan);
    return [
      '**PRODUCT REFERENCES — ' + rangeHead + '**',
      '',
      'These images define the product\'s identity and appearance. Use all available product references together to understand its design accurately.',
      '',
      'Preserve its geometry, proportions, materials, colours, textures, patterns, graphics, artwork, branding, and construction. Ignore the backgrounds of these images.'
    ].join('\n');
  }

  function buildBody(plan) {
    const hasA1 = plan.hasA1;
    const hasA2 = plan.hasA2;
    const hasA3 = plan.hasA3;
    const a1Ref = refTick(plan, 'a1');
    const a2Ref = refTick(plan, 'a2');
    const a3Ref = refTick(plan, 'a3');
    const productRange = productRefRange(plan);

    const lines = [];

    // §2 MAIN GENERATION OBJECTIVE
    lines.push('## 2. MAIN GENERATION OBJECTIVE');
    lines.push('');
    lines.push('Create one highly photorealistic product composition using:');
    if (hasA1) lines.push('- The environment from ' + a1Ref + '.');
    if (hasA2) lines.push('- The camera setup from ' + a2Ref + '.');
    lines.push('- The product from ' + productRange + '.');
    if (hasA3) lines.push('- ' + a3Ref + ' only as explicitly instructed.');
    lines.push('');
    lines.push('The product and background must appear as parts of one professionally photographed scene.');
    lines.push('');

    // §3 PRODUCT ACCURACY
    lines.push('## 3. PRODUCT ACCURACY');
    lines.push('');
    lines.push('Preserve the product\'s original identity and design exactly.');
    lines.push('');
    lines.push('Do not modify, simplify, stylise, reinterpret, or invent product features. Maintain its original shape, proportions, construction, materials, colours, patterns, textures, and details.');
    lines.push('');
    lines.push('Only adapt its placement, orientation, and perspective to fit the scene and camera viewpoint. Never distort its geometry or physical proportions.');
    lines.push('');

    // §4 CAMERA (only when A2 present)
    if (hasA2) {
      lines.push('## 4. CAMERA, PERSPECTIVE AND FRAMING');
      lines.push('');
      lines.push('Apply the camera setup from ' + a2Ref +
        ' consistently to the **entire final composition, including the product and background**.');
      lines.push('');
      lines.push('Match its camera angle, viewpoint, elevation, position, FOV, zoom, perspective, framing, and exact crop.');
      lines.push('');
      if (hasA1) {
        lines.push('The background must visually follow the same camera viewpoint as the product. Do not retain the original background\'s camera perspective when it conflicts with the specified camera reference.');
        lines.push('');
      }
      lines.push('**STRICT FRAMING MATCH:**');
      lines.push('- Match the visible area and crop boundaries of the camera reference.');
      lines.push('- Maintain equivalent subject placement and distance from image edges.');
      lines.push('- Preserve the same amount of visible foreground and surrounding environment.');
      lines.push('- Match the close-up, medium-shot, or wide-shot framing.');
      lines.push('- Retain equivalent partial cropping of elements at the image edges.');
      lines.push('');
      lines.push('Do not zoom out, widen the composition, reveal additional surroundings, or add margins. Do not match only the camera angle while ignoring its zoom and crop.');
      lines.push('');
      lines.push('The product and background must share one consistent camera perspective and framing.');
      lines.push('');
    }

    // §5 BACKGROUND (only when A1 present)
    if (hasA1) {
      lines.push('## 5. BACKGROUND PRESERVATION');
      lines.push('');
      lines.push('Maintain the visual identity and design of the environment in ' + a1Ref + '.');
      lines.push('');
      lines.push('Preserve its existing furniture, props, architecture, surfaces, colours, materials, textures, and spatial arrangement. Adapt their visible perspective to the specified camera setup without changing their design.');
      lines.push('');
      lines.push('Do not introduce unrelated objects or transfer visual elements from the camera or product references.');
      lines.push('');
    }

    // §6 LIGHTING
    lines.push('## 6. LIGHTING, SHADOWS AND REFLECTIONS');
    lines.push('');
    lines.push('Maintain natural, physically plausible lighting consistent with the environment.');
    lines.push('');
    lines.push('- Create realistic contact and cast shadows.');
    lines.push('- Match lighting direction and intensity to the scene.');
    lines.push('- Generate material-appropriate highlights and reflections.');
    lines.push('- Maintain believable ambient occlusion and light interaction.');
    lines.push('- Preserve the product\'s original material appearance and colours.');
    lines.push('');
    lines.push('Avoid artificial glow, excessive reflections, and inconsistent shadows.');
    lines.push('');

    // §7 PHOTOREALISM
    lines.push('## 7. PHOTOREALISM AND IMAGE QUALITY');
    lines.push('');
    lines.push('The final image must have:');
    lines.push('- High photorealism and accurate product details.');
    lines.push('- Natural lighting, shadows, and reflections.');
    lines.push('- Correct perspective, scale, and spatial integration.');
    lines.push('- Realistic materials and surface finishes.');
    lines.push('- Clean edges and seamless compositing.');
    lines.push('- Consistent photographic depth and focus.');
    lines.push('');
    lines.push('Avoid CGI-like appearances, distorted geometry, artificial textures, unnatural shadows, and visible compositing artefacts.');
    lines.push('');

    // §8 REFERENCE PRIORITY
    lines.push('## 8. REFERENCE PRIORITY');
    lines.push('');
    lines.push('Maintain strict separation between the references:');
    lines.push('');
    if (hasA1) lines.push('- ' + a1Ref + ' — Background and environment.');
    if (hasA2) lines.push('- ' + a2Ref + ' — Camera properties, perspective, framing, and crop only.');
    if (hasA3) lines.push('- ' + a3Ref + ' — Explicitly specified purpose only.');
    lines.push('- ' + productRange + ' — Product identity and appearance only.');
    lines.push('');
    if (hasA1 && hasA2) {
      lines.push('Product accuracy and background design preservation must be maintained while adapting the complete composition to the specified camera setup.');
    } else if (hasA2) {
      lines.push('Product accuracy must be maintained while adapting the complete composition to the specified camera setup.');
    } else if (hasA1) {
      lines.push('Product accuracy and background design preservation must be maintained.');
    } else {
      lines.push('Product accuracy must be maintained.');
    }
    lines.push('');

    // §9 FINAL
    lines.push('## 9. FINAL REQUIREMENT');
    lines.push('');
    lines.push('Generate one cohesive, highly photorealistic image.');
    lines.push('');
    {
      let sentence = 'Preserve the original product design';
      if (hasA1) sentence += ' and background identity';
      if (hasA2) sentence += ', apply the specified camera viewpoint and exact framing to the entire scene';
      sentence += ', and ensure everything appears naturally photographed together.';
      lines.push(sentence);
    }
    lines.push('');
    lines.push('Do not transfer unintended visual content between references or introduce unrequested changes.');

    return lines.join('\n');
  }

  /**
   * @param {{ hasA1?: boolean, hasA2?: boolean, hasA3?: boolean, bCount?: number, appendix?: string }} opts
   */
  function compilePrompt(opts) {
    const plan = buildPlan(opts || {});
    const parts = [];
    parts.push('# PHOTOREALISTIC PRODUCT COMPOSITION');
    parts.push('');
    parts.push('## 1. IMAGE INPUTS AND THEIR ROLES');
    parts.push('');
    (plan.slots || []).forEach((slot) => {
      if (slot.role === 'a1') {
        parts.push(blockA1(slot));
        parts.push('');
      } else if (slot.role === 'a2') {
        parts.push(blockA2(slot));
        parts.push('');
      } else if (slot.role === 'a3') {
        parts.push(blockA3(slot));
        parts.push('');
      }
    });
    // B is compulsory — always emit product block (numbers shift with A1/A2/A3).
    parts.push(blockProduct(plan));
    parts.push('');
    parts.push(buildBody(plan));
    const appendix = String((opts && opts.appendix) || '').trim();
    if (appendix) {
      parts.push('');
      parts.push('## SHOT-SPECIFIC TARGET');
      parts.push('');
      parts.push(appendix);
    }
    return {
      text: parts.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
      plan: plan
    };
  }

  /** Canonical Universal DB numbering: 1=A1, 2=A2, 3=A3, 4+=B1… */
  function canonRoleForNum(n) {
    const num = Number(n);
    if (num === 1) return 'a1';
    if (num === 2) return 'a2';
    if (num === 3) return 'a3';
    if (num >= 4) return 'b:' + (num - 4);
    return null;
  }

  function stripInputBlockByLabel(text, labelRe) {
    // Accept old reference_image_url_N and live Answerly keys in the heading.
    const re = new RegExp(
      '\\*\\*INPUT IMAGE\\s+\\d+\\s*[—\\-]\\s*`[^`]+`\\s*[—\\-]\\s*' +
        labelRe.source +
        '\\*\\*[\\s\\S]*?(?=\\n\\*\\*INPUT IMAGE|\\n\\*\\*PRODUCT REFERENCES|\\n##\\s|$)',
      'i'
    );
    return String(text || '').replace(re, '\n');
  }

  function stripMarkdownSection(text, headingRe) {
    const re = new RegExp(
      headingRe.source + '[\\s\\S]*?(?=\\n##\\s|$)',
      'i'
    );
    return String(text || '').replace(re, '\n');
  }

  /**
   * Adapt a Prompt-DB Universal Primary master (canonical A1=1…B=4+) to the live
   * slot plan: drop missing A* blocks/sections and remap to Answerly field names.
   * @param {string} dbText
   * @param {{ hasA1?: boolean, hasA2?: boolean, hasA3?: boolean, bCount?: number, slots?: array }|object} planOrOpts
   */
  function adaptUniversalPrompt(dbText, planOrOpts) {
    const plan = planOrOpts && planOrOpts.slots
      ? planOrOpts
      : buildPlan(planOrOpts || {});
    let t = String(dbText || '').trim();
    if (!t) return { text: '', plan: plan };

    t = t.replace(/\n---\s*\nNOTE FOR AUTHORS:[\s\S]*$/i, '').trim();

    if (!plan.hasA1) {
      t = stripInputBlockByLabel(t, /MASTER BACKGROUND/);
      t = stripMarkdownSection(t, /##\s*5\.\s*BACKGROUND PRESERVATION/);
    }
    if (!plan.hasA2) {
      t = stripInputBlockByLabel(t, /CAMERA REFERENCE/);
      t = stripMarkdownSection(t, /##\s*4\.\s*CAMERA(?:[,\s]+PERSPECTIVE)?(?:\s+AND\s+FRAMING)?/);
    }
    if (!plan.hasA3) {
      t = stripInputBlockByLabel(t, /OPTIONAL REFERENCE/);
    }

    const liveByRole = {};
    (plan.slots || []).forEach((s) => {
      if (s.role === 'b') liveByRole['b:' + s.bIndex] = s.inputImage;
      else liveByRole[s.role] = s.inputImage;
    });

    function remapCanonToLive(canonNum) {
      const role = canonRoleForNum(canonNum);
      if (!role || liveByRole[role] == null) return '__DROP_REF__';
      return '__LIVE_REF_' + liveByRole[role] + '__';
    }

    // Tokenize every known ref token (old _N + Answerly names) so remaps do not collide.
    t = t.replace(/`([^`]+)`/g, function (full, inner) {
      const canon = canonNumFromRefToken(inner);
      if (canon == null) return full;
      return '`' + remapCanonToLive(canon) + '`';
    });
    // Bare tokens outside backticks (rare).
    t = t.replace(
      /\b(reference_image_url_\d+|reference_image_url|second_reference_url|third_reference_url|reference_\d+_url|fourth_reference_url|fifth_reference_url|sixth_reference_url|seventh_reference_url|eighth_reference_url)\b/g,
      function (tok) {
        const canon = canonNumFromRefToken(tok);
        if (canon == null) return tok;
        return remapCanonToLive(canon);
      }
    );
    t = t.split('\n').filter(function (line) {
      return line.indexOf('__DROP_REF__') < 0;
    }).join('\n');
    t = t.replace(/__LIVE_REF_(\d+)__/g, function (_, n) {
      return answerlyRefKey(n);
    });

    // Align "INPUT IMAGE N — `answerlyKey`" with the remapped slot index.
    t = t.replace(
      /\*\*INPUT IMAGE\s+\d+\s*[—\-]\s*`([^`]+)`/gi,
      function (full, key) {
        const liveN = canonNumFromRefToken(key);
        if (liveN == null) return full;
        return '**INPUT IMAGE ' + liveN + ' — `' + answerlyRefKey(liveN) + '`';
      }
    );

    const rangeHead = productRefRangeHeading(plan);
    t = t.replace(
      /\*\*PRODUCT REFERENCES\s*[—\-][^*]*\*\*/i,
      '**PRODUCT REFERENCES — ' + rangeHead + '**'
    );

    // Ensure every live B ref is mentioned at least once near the product block.
    const bSlots = productSlots(plan);
    if (bSlots.length > 1) {
      const need = bSlots.map(function (s) { return s.refKey; });
      const missing = need.filter(function (k) {
        return t.indexOf('`' + k + '`') < 0 && t.indexOf(k) < 0;
      });
      if (missing.length) {
        t = t.replace(
          /(\*\*PRODUCT REFERENCES[^\n]*\*\*\n+)/i,
          '$1Additional product references in this run: ' +
            missing.map(function (k) { return '`' + k + '`'; }).join(', ') + '.\n\n'
        );
      }
    }

    return {
      text: t.replace(/\n{3,}/g, '\n\n').trim(),
      plan: plan
    };
  }

  /**
   * Compile from Prompt DB Universal text (preferred) with live slot renumbering.
   * Falls back to compilePrompt when dbText is empty.
   */
  function compileFromUniversal(dbText, opts) {
    const o = opts || {};
    const plan = buildPlan(o);
    const appendix = String(o.appendix || '').trim();
    const adapted = adaptUniversalPrompt(dbText, plan);
    let body = adapted.text;
    if (!body) {
      return compilePrompt({
        hasA1: plan.hasA1,
        hasA2: plan.hasA2,
        hasA3: plan.hasA3,
        bCount: plan.bCount,
        appendix: appendix
      });
    }
    if (appendix) {
      body = body + '\n\n## SHOT-SPECIFIC TARGET\n\n' + appendix;
    }
    return {
      text: body.replace(/\n{3,}/g, '\n\n').trim(),
      plan: plan,
      fromDb: true
    };
  }

  root.PrimaryPromptCore = {
    buildPlan: buildPlan,
    compilePrompt: compilePrompt,
    adaptUniversalPrompt: adaptUniversalPrompt,
    compileFromUniversal: compileFromUniversal,
    productRefRange: productRefRange,
    productRefsPhrase: productRefsPhrase,
    clampBCount: clampBCount,
    answerlyRefKey: answerlyRefKey,
    canonNumFromRefToken: canonNumFromRefToken
  };
})(typeof window !== 'undefined' ? window : globalThis);
