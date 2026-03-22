/**
 * Dynamic Content Editors for each H5P type.
 * Generates form fields based on the H5P type definition.
 */

class ContentEditorManager {
  constructor(containerEl) {
    this.container = containerEl;
    this.currentType = null;
    this.listCounters = {};
  }

  /**
   * Render the editor for a given H5P type with optional existing data.
   */
  render(typeId, existingData = {}) {
    const typeDef = H5P_TYPES[typeId];
    if (!typeDef) {
      this.container.innerHTML = '';
      this.container.classList.remove('active');
      this.currentType = null;
      return;
    }

    this.currentType = typeId;
    this.listCounters = {};
    this.container.innerHTML = '';
    this.container.classList.add('active');

    const heading = document.createElement('h4');
    heading.textContent = `${typeDef.icon} ${typeDef.name} — Inhalt konfigurieren`;
    this.container.appendChild(heading);

    for (const field of typeDef.fields) {
      const value = existingData[field.key];
      this.renderField(this.container, field, value);
    }
  }

  /**
   * Render a single field into a parent container.
   */
  renderField(parent, field, value) {
    switch (field.type) {
      case 'text':
        this.renderTextField(parent, field, value);
        break;
      case 'textarea':
        this.renderTextareaField(parent, field, value);
        break;
      case 'number':
        this.renderNumberField(parent, field, value);
        break;
      case 'select':
        this.renderSelectField(parent, field, value);
        break;
      case 'checkbox':
        this.renderCheckboxField(parent, field, value);
        break;
      case 'list':
        this.renderListField(parent, field, value);
        break;
      case 'group':
        this.renderGroupField(parent, field, value);
        break;
    }
  }

  renderTextField(parent, field, value) {
    const group = this.createFormGroup(field.label, field.required);
    const input = document.createElement('input');
    input.type = 'text';
    input.name = `content_${field.key}`;
    input.value = value || field.default || '';
    input.placeholder = field.placeholder || '';
    if (field.required) input.required = true;
    group.appendChild(input);
    parent.appendChild(group);
  }

  renderTextareaField(parent, field, value) {
    const group = this.createFormGroup(field.label, field.required);
    const textarea = document.createElement('textarea');
    textarea.name = `content_${field.key}`;
    textarea.rows = 4;
    textarea.value = value || field.default || '';
    textarea.placeholder = field.placeholder || '';
    if (field.required) textarea.required = true;
    group.appendChild(textarea);
    parent.appendChild(group);
  }

  renderNumberField(parent, field, value) {
    const group = this.createFormGroup(field.label, field.required);
    const input = document.createElement('input');
    input.type = 'number';
    input.name = `content_${field.key}`;
    input.value = value !== undefined ? value : (field.default || 0);
    group.appendChild(input);
    parent.appendChild(group);
  }

  renderSelectField(parent, field, value) {
    const group = this.createFormGroup(field.label, field.required);
    const select = document.createElement('select');
    select.name = `content_${field.key}`;
    for (const opt of field.options) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (value === opt.value || (!value && field.default === opt.value)) {
        option.selected = true;
      }
      select.appendChild(option);
    }
    group.appendChild(select);
    parent.appendChild(group);
  }

  renderCheckboxField(parent, field, value) {
    const group = document.createElement('div');
    group.className = 'form-group checkbox-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = `content_${field.key}`;
    input.id = `content_${field.key}`;
    input.checked = value !== undefined ? !!value : !!field.default;
    const label = document.createElement('label');
    label.htmlFor = `content_${field.key}`;
    label.textContent = field.label;
    group.appendChild(input);
    group.appendChild(label);
    parent.appendChild(group);
  }

  renderListField(parent, field, value) {
    const group = this.createFormGroup(field.label);
    const listContainer = document.createElement('div');
    listContainer.className = 'list-container';
    listContainer.dataset.fieldKey = field.key;

    this.listCounters[field.key] = 0;

    // Render existing items
    const items = Array.isArray(value) ? value : [];
    for (const item of items) {
      this.addListItem(listContainer, field, item);
    }

    // Add button
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn-add-item';
    addBtn.textContent = `+ ${field.label} hinzufügen`;
    addBtn.addEventListener('click', () => {
      this.addListItem(listContainer, field, {});
    });

    group.appendChild(listContainer);
    group.appendChild(addBtn);
    parent.appendChild(group);

    // Start with one empty item if none exist
    if (items.length === 0) {
      this.addListItem(listContainer, field, {});
    }
  }

  addListItem(container, field, itemData) {
    const idx = this.listCounters[field.key]++;
    const item = document.createElement('div');
    item.className = 'editor-item';

    const header = document.createElement('div');
    header.className = 'editor-item-header';
    const h5 = document.createElement('h5');
    h5.textContent = `#${idx + 1}`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-danger btn-sm';
    removeBtn.textContent = '✕ Entfernen';
    removeBtn.addEventListener('click', () => {
      item.remove();
    });
    header.appendChild(h5);
    header.appendChild(removeBtn);
    item.appendChild(header);

    for (const subField of field.itemFields) {
      const compositeField = {
        ...subField,
        key: `${field.key}_${idx}_${subField.key}`,
      };
      const val = itemData ? itemData[subField.key] : undefined;
      this.renderField(item, compositeField, val);
    }

    container.appendChild(item);
  }

  renderGroupField(parent, field, value) {
    const group = this.createFormGroup(field.label);
    const groupContainer = document.createElement('div');
    groupContainer.className = 'editor-item';

    const data = value || {};
    for (const subField of field.fields) {
      const compositeField = {
        ...subField,
        key: `${field.key}_${subField.key}`,
      };
      this.renderField(groupContainer, compositeField, data[subField.key]);
    }

    group.appendChild(groupContainer);
    parent.appendChild(group);
  }

  createFormGroup(label, required) {
    const group = document.createElement('div');
    group.className = 'form-group';
    const labelEl = document.createElement('label');
    labelEl.textContent = label + (required ? ' *' : '');
    group.appendChild(labelEl);
    return group;
  }

  /**
   * Collect all content data from the editor.
   */
  collectData() {
    if (!this.currentType) return {};

    const typeDef = H5P_TYPES[this.currentType];
    const data = {};

    for (const field of typeDef.fields) {
      data[field.key] = this.collectFieldData(field);
    }

    return data;
  }

  collectFieldData(field) {
    switch (field.type) {
      case 'text':
      case 'textarea':
      case 'number':
      case 'select': {
        const el = this.container.querySelector(`[name="content_${field.key}"]`);
        if (!el) return field.default || '';
        if (field.type === 'number') return parseFloat(el.value) || 0;
        return el.value;
      }
      case 'checkbox': {
        const el = this.container.querySelector(`[name="content_${field.key}"]`);
        return el ? el.checked : !!field.default;
      }
      case 'list': {
        return this.collectListData(field);
      }
      case 'group': {
        return this.collectGroupData(field);
      }
      default:
        return null;
    }
  }

  collectListData(field) {
    const container = this.container.querySelector(`[data-field-key="${field.key}"]`);
    if (!container) return [];

    const items = container.querySelectorAll('.editor-item');
    const result = [];

    items.forEach((itemEl, idx) => {
      const itemData = {};
      for (const subField of field.itemFields) {
        const compositeKey = `${field.key}_${idx}_${subField.key}`;
        const el = itemEl.querySelector(`[name="content_${compositeKey}"]`);
        if (!el) continue;
        if (subField.type === 'checkbox') {
          itemData[subField.key] = el.checked;
        } else if (subField.type === 'number') {
          itemData[subField.key] = parseFloat(el.value) || 0;
        } else {
          itemData[subField.key] = el.value;
        }
      }
      result.push(itemData);
    });

    return result;
  }

  collectGroupData(field) {
    const data = {};
    for (const subField of field.fields) {
      const compositeKey = `${field.key}_${subField.key}`;
      const el = this.container.querySelector(`[name="content_${compositeKey}"]`);
      if (!el) continue;
      if (subField.type === 'checkbox') {
        data[subField.key] = el.checked;
      } else if (subField.type === 'number') {
        data[subField.key] = parseFloat(el.value) || 0;
      } else {
        data[subField.key] = el.value;
      }
    }
    return data;
  }

  /**
   * Clear the editor.
   */
  clear() {
    this.container.innerHTML = '';
    this.container.classList.remove('active');
    this.currentType = null;
    this.listCounters = {};
  }
}
