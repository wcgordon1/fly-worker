function cleanString(value) {
  return String(value ?? "").trim();
}

function titleCaseFromKey(value) {
  return cleanString(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function mapPrimitiveBubbleType(typeValue) {
  return (
    {
      text: "varchar",
      number: "float",
      date: "datetime",
      yes_no: "bool",
      bool: "bool",
      file: "file",
      image: "image"
    }[typeValue] || typeValue || "varchar"
  );
}

// Build a stable DBML-like string from extracted database JSON.
function buildDatabaseDbml(database, appId) {
  const lines = [
    `Project "${appId || "bubble-app"}" {`,
    '  database_type: "Bubble.io"',
    "}",
    ""
  ];

  for (const t of database.types) {
    lines.push(`Table custom."${t.name}" {`);
    lines.push('\t"_id" varchar');

    for (const field of t.fields) {
      if (field.isRelationship) {
        lines.push(`\t"${field.displayName}" ${field.baseType}.id`);
      } else {
        lines.push(`\t"${field.displayName}" ${field.dbType}${field.isList ? "[]" : ""}`);
      }
    }

    lines.push("}");
    lines.push("");
  }

  for (const ref of database.refs) {
    lines.push(
      `Ref: custom."${ref.fromType}"."${ref.fromField}" ${
        ref.isList ? "<" : "-"
      } custom."${ref.toType}"."_id"`
    );
  }

  return lines.join("\n");
}

function extractDatabase(userTypesRaw, appId) {
  const result = {
    types: [],
    refs: [],
    dbml: "",
    warnings: []
  };

  if (!userTypesRaw || typeof userTypesRaw !== "object") {
    result.warnings.push("app.user_types is missing or not an object");
    return result;
  }

  const typeEntries = Object.entries(userTypesRaw);
  const typeNameByKey = {};

  for (const [typeKey, typeObj] of typeEntries) {
    if (!typeObj || typeof typeObj !== "object") continue;
    typeNameByKey[typeKey] = typeObj["%d"] || titleCaseFromKey(typeKey);
  }

  const typeKeySet = new Set(Object.keys(typeNameByKey));

  for (const [typeKey, typeObj] of typeEntries) {
    if (!typeObj || typeof typeObj !== "object") continue;

    const typeName = typeNameByKey[typeKey] || titleCaseFromKey(typeKey);
    const fieldsRaw = typeObj["%f3"] && typeof typeObj["%f3"] === "object" ? typeObj["%f3"] : {};
    const typeRecord = {
      key: typeKey,
      name: typeName,
      fields: []
    };

    for (const [fieldKey, fieldObj] of Object.entries(fieldsRaw)) {
      if (!fieldObj || typeof fieldObj !== "object") continue;

      const displayName = fieldObj["%d"] || titleCaseFromKey(fieldKey);
      const rawType = cleanString(fieldObj["%v"]);
      const isList = rawType.startsWith("list.");
      const baseType = isList ? rawType.slice(5) : rawType;
      const isRelationship = Boolean(baseType && typeKeySet.has(baseType));
      const mappedDbType = mapPrimitiveBubbleType(baseType || "varchar");

      typeRecord.fields.push({
        key: fieldKey,
        displayName,
        rawType,
        isList,
        baseType,
        isRelationship,
        dbType: isRelationship ? `${baseType}.id` : mappedDbType
      });

      if (isRelationship) {
        result.refs.push({
          fromType: typeName,
          fromField: displayName,
          toType: typeNameByKey[baseType] || titleCaseFromKey(baseType),
          isList
        });
      }
    }

    result.types.push(typeRecord);
  }

  result.dbml = buildDatabaseDbml(result, appId);
  if (result.types.length === 0) {
    result.warnings.push("app.user_types exists but no types were extracted");
  }

  return result;
}

function buildOptionSetsDbml(optionSets) {
  const lines = [];

  for (const item of optionSets.items) {
    lines.push(`Table option_set."${item.name}" {`);
    lines.push('\t"_id" varchar');

    for (const attr of item.attributes) {
      lines.push(`\t"${attr.displayName}" ${attr.dbType}${attr.isList ? "[]" : ""}`);
    }

    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

function extractOptionSets(optionSetsRaw) {
  const result = {
    items: [],
    dbml: "",
    warnings: []
  };

  if (!optionSetsRaw || typeof optionSetsRaw !== "object") {
    result.warnings.push("app.option_sets is missing or not an object");
    return result;
  }

  for (const [setKey, setObj] of Object.entries(optionSetsRaw)) {
    if (!setObj || typeof setObj !== "object") continue;

    const name = setObj["%d"] || titleCaseFromKey(setKey);
    const attrsRaw = setObj.attributes && typeof setObj.attributes === "object" ? setObj.attributes : {};

    const record = {
      key: setKey,
      name,
      attributes: []
    };

    for (const [attrKey, attrObj] of Object.entries(attrsRaw)) {
      if (!attrObj || typeof attrObj !== "object") continue;

      const displayName = attrObj["%d"] || titleCaseFromKey(attrKey);
      const rawType = cleanString(attrObj["%v"]);
      const isList = rawType.startsWith("list.");
      const baseType = isList ? rawType.slice(5) : rawType;

      record.attributes.push({
        key: attrKey,
        displayName,
        rawType,
        isList,
        baseType,
        dbType: mapPrimitiveBubbleType(baseType)
      });
    }

    result.items.push(record);
  }

  result.dbml = buildOptionSetsDbml(result);
  if (result.items.length === 0) {
    result.warnings.push("app.option_sets exists but no option sets were extracted");
  }

  return result;
}

function extractPages(pagesObjRaw) {
  const result = {
    items: [],
    count: 0,
    warnings: []
  };

  if (!pagesObjRaw || typeof pagesObjRaw !== "object") {
    result.warnings.push('app["%p3"] pages object is missing or not an object');
    return result;
  }

  result.items = Object.values(pagesObjRaw)
    .filter((p) => p && typeof p === "object" && p["%x"] === "Page")
    .map((p) => p["%nm"])
    .filter(Boolean);

  result.count = result.items.length;
  if (result.count === 0) {
    result.warnings.push("pages object exists but no page names were extracted");
  }

  return result;
}

function extractColors(tokensRaw) {
  const result = {
    "%del:false": [],
    "%del:true": [],
    warnings: []
  };

  if (!tokensRaw || typeof tokensRaw !== "object") {
    result.warnings.push('app.settings.client_safe.color_tokens_user["%d1"] is missing or not an object');
    return result;
  }

  const entries = Object.entries(tokensRaw).sort(
    (a, b) => (a?.[1]?.order ?? 9999) - (b?.[1]?.order ?? 9999)
  );

  for (const [id, value] of entries) {
    if (!value || typeof value !== "object") continue;

    const item = {
      id,
      "%nm": value["%nm"] ?? "",
      "%d3": value["%d3"] ?? "",
      rgba: value.rgba ?? ""
    };

    if (value["%del"] === true) {
      result["%del:true"].push(item);
    } else {
      result["%del:false"].push(item);
    }
  }

  if (result["%del:false"].length === 0 && result["%del:true"].length === 0) {
    result.warnings.push("color tokens object exists but no tokens were extracted");
  }

  return result;
}

module.exports = {
  extractDatabase,
  extractOptionSets,
  extractPages,
  extractColors
};
