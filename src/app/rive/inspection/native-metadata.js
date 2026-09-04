function numberMember(object, key, minimum = 0) {
    try {
        const value = object?.[key];
        return typeof value === 'number' && Number.isFinite(value) && value >= minimum ? value : null;
    } catch { return null; }
}

function timelineMetadata(animation) {
    const fps = numberMember(animation, 'fps', Number.MIN_VALUE);
    const durationFrames = numberMember(animation, 'duration');
    const workStartFrame = numberMember(animation, 'workStart');
    const workEndFrame = numberMember(animation, 'workEnd');
    return {
        name: String(animation.name), fps, durationFrames,
        durationSeconds: fps !== null && durationFrames !== null ? durationFrames / fps : null,
        workStartFrame, workEndFrame,
        workAreaEnabled: typeof animation.enableWorkArea === 'boolean' ? animation.enableWorkArea : null,
    };
}

// Definitions and inputs are borrowed from their owner. Only the instances
// constructed here are deleted; deleting borrowed definitions can corrupt a file.
export function inspectNativeFile(file, runtime, assertCurrent = () => {}) {
    const artboards = [];
    for (let index = 0; index < file.artboardCount(); index += 1) {
        assertCurrent();
        const artboard = file.artboardByIndex(index);
        if (!artboard) throw new Error(`Inspection could not instantiate artboard ${index}.`);
        try {
            const animations = [];
            const stateMachines = [];
            for (let i = 0; i < artboard.animationCount(); i += 1) {
                animations.push(timelineMetadata(artboard.animationByIndex(i)));
            }
            for (let i = 0; i < artboard.stateMachineCount(); i += 1) {
                assertCurrent();
                const definition = artboard.stateMachineByIndex(i);
                const instance = new runtime.StateMachineInstance(definition, artboard);
                try {
                    const inputs = [];
                    for (let j = 0; j < instance.inputCount(); j += 1) {
                        const input = instance.input(j);
                        inputs.push({ name: String(input.name), type: numberMember(input, 'type') });
                    }
                    stateMachines.push({ name: String(definition.name), inputs });
                } finally { instance.delete(); }
            }
            artboards.push({ name: String(artboard.name), animations, stateMachines });
        } finally { artboard.delete(); }
    }
    return artboards;
}
