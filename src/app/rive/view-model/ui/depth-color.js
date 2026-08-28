const VM_DEPTH_COLORS = ['#C4F82A', '#38BDF8', '#A78BFA', '#FB923C', '#F472B6', '#34D399'];

export function getVmDepthColor(depth) {
    return VM_DEPTH_COLORS[depth % VM_DEPTH_COLORS.length];
}
