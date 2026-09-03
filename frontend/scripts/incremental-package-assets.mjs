const jarCssPattern = /^web\/app\/assets\/index-[A-Za-z0-9_-]+\.css$/
const classpathCssPattern = /^index-[A-Za-z0-9_-]+\.css$/

export function indexedJarCss(entries) {
  return entries.filter((entry) => jarCssPattern.test(entry))
}

function exactlyOneIndexedCss(label, entries) {
  if (entries.length !== 1) {
    throw new Error(`${label} must contain exactly one indexed CSS asset; found: ${entries.join(", ")}`)
  }
  return entries[0]
}

function classpathName(jarEntry) {
  return jarEntry.substring("web/app/assets/".length)
}

function indexedClasspathCss(entries) {
  return entries.filter((entry) => classpathCssPattern.test(entry))
}

export function selectSecondBuildCss(firstCss, jarEntries, classpathEntries) {
  const secondCss = exactlyOneIndexedCss("Second shaded JAR", indexedJarCss(jarEntries))
  const secondClassCss = exactlyOneIndexedCss("Second classpath assets", indexedClasspathCss(classpathEntries))
  const firstClassCss = classpathName(firstCss)

  if (secondCss === firstCss) throw new Error("CSS fixture mutation did not change the Vite hash")
  if (jarEntries.includes(firstCss)) throw new Error(`Obsolete first hashed asset remains in shaded JAR: ${firstCss}`)
  if (secondClassCss !== classpathName(secondCss)) {
    throw new Error(`Second classpath CSS disagrees with shaded JAR: ${secondClassCss} !== ${classpathName(secondCss)}`)
  }
  if (classpathEntries.includes(firstClassCss)) {
    throw new Error(`Obsolete first hashed asset remains in classes: ${firstClassCss}`)
  }
  return secondCss
}

export function assertRestoredBuildCss(restoredCss, mutatedCssEntries, jarEntries, classpathEntries) {
  const restoredJarCss = exactlyOneIndexedCss("Recovery shaded JAR", indexedJarCss(jarEntries))
  const restoredClassCss = exactlyOneIndexedCss("Recovery classpath assets", indexedClasspathCss(classpathEntries))

  if (restoredJarCss !== restoredCss) {
    throw new Error(`Recovery shaded JAR does not contain restored CSS: ${restoredJarCss} !== ${restoredCss}`)
  }
  if (restoredClassCss !== classpathName(restoredCss)) {
    throw new Error(`Recovery classpath CSS disagrees with restored shaded JAR: ${restoredClassCss} !== ${classpathName(restoredCss)}`)
  }
  for (const mutatedCss of mutatedCssEntries) {
    const mutatedClassCss = classpathName(mutatedCss)
    if (jarEntries.includes(mutatedCss)) throw new Error(`Mutated CSS remains in recovery shaded JAR: ${mutatedCss}`)
    if (classpathEntries.includes(mutatedClassCss)) {
      throw new Error(`Mutated CSS remains in recovery classes: ${mutatedClassCss}`)
    }
  }
}

export function surfaceVerificationAndRecoveryErrors(verificationError, recoveryError) {
  if (verificationError && recoveryError) {
    throw new AggregateError(
      [verificationError, recoveryError],
      "Incremental package verification and recovery both failed",
    )
  }
  if (verificationError) throw verificationError
  if (recoveryError) throw recoveryError
}
